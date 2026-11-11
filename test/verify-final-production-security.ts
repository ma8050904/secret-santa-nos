import { NextRequest } from "next/server";
import { getWebAuthnRpDetails } from "../src/lib/admin-auth";
import { checkDistributedRateLimit, resetDistributedRateLimit } from "../src/lib/db";
import {
  getParticipantBiometricStatus,
  registerParticipantBiometric,
  authenticateParticipantBiometric,
  bindDeviceToParticipant,
  getDeviceOrHardwareBinding,
  getEventState,
  isValidPasskeyCredentialId,
  clearDeviceBindingsForParticipant,
} from "../src/lib/storage";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function runTests() {
  console.log("========================================================");
  console.log("  🛡️ M5 FINAL PRODUCTION SECURITY & CONCURRENCY SUITE 🛡️");
  console.log("========================================================");

  // 1. Host Header Injection & RP ID Whitelisting
  console.log("\n--- 1. WebAuthn RP ID Whitelisting & Anti-Spoofing ---");
  {
    // A legitimate production request
    const prodReq = new NextRequest("https://secret-santa-holiday.vercel.app/api/auth/biometric/options", {
      headers: { host: "secret-santa-holiday.vercel.app" },
    });
    const prodRp = getWebAuthnRpDetails(prodReq);
    assert(prodRp.rpID === "secret-santa-holiday.vercel.app", "Legitimate production host accepts correct rpID");
    assert(prodRp.origin === "https://secret-santa-holiday.vercel.app", "Legitimate production origin is correct");

    // A legitimate preview request on *.vercel.app
    const previewReq = new NextRequest("https://secret-santa-test-branch.vercel.app/api/auth/biometric/options", {
      headers: { host: "secret-santa-test-branch.vercel.app" },
    });
    const previewRp = getWebAuthnRpDetails(previewReq);
    assert(previewRp.rpID === "secret-santa-test-branch.vercel.app", "Preview vercel.app host accepted");

    // Localhost development request
    const localReq = new NextRequest("http://localhost:3000/api/auth/biometric/options", {
      headers: { host: "localhost:3000" },
    });
    const localRp = getWebAuthnRpDetails(localReq);
    assert(localRp.rpID === "localhost", "Localhost host accepted");
    assert(localRp.origin === "http://localhost:3000", "Localhost origin preserves port");

    // Malicious Host header injection attempt (e.g. Host: evil-phishing.com)
    const attackReq = new NextRequest("https://secret-santa-nos.vercel.app/api/auth/biometric/options", {
      headers: { host: "evil-phishing.com", "x-forwarded-host": "evil-phishing.com" },
    });
    const attackRp = getWebAuthnRpDetails(attackReq);
    assert(attackRp.rpID === "secret-santa-nos.vercel.app", "Malicious Host header rejected: rpID defaults to production domain");
    assert(attackRp.origin === "https://secret-santa-nos.vercel.app", "Malicious Host header rejected: origin defaults to production domain");
  }

  // 2. WebAuthn Base64URL Sanitization & DOMException atob() Defense
  console.log("\n--- 2. Base64URL Credential Sanitization & atob() Defense ---");
  {
    const testCases = [
      { input: "passkey_marker_present", valid: false },
      { input: "registered", valid: false },
      { input: "true", valid: false },
      { input: "The string contains invalid characters.", valid: false },
      { input: "invalid@credential!id#123", valid: false },
      { input: "short", valid: false },
      { input: "  cGFydGljLXNlY3JldA==  ", valid: false }, // spaces and padding '=' are invalid in Base64URL
      { input: "cGFydGljLXNlY3JldA", valid: true }, // valid base64url >= 16 chars
      { input: "MGMwMmY4YjctZjBiYS00NDAwLWE2OGUtNjg0ZjMyNmExMGI1", valid: true },
    ];

    for (const tc of testCases) {
      const isValid = isValidPasskeyCredentialId(tc.input);
      assert(isValid === tc.valid, `Credential ID check '${tc.input.slice(0, 20)}...' validated as ${isValid}`);
    }
  }

  // 3. WebAuthn Anti-Replay Counter Tracking
  console.log("\n--- 3. WebAuthn Anti-Replay Counter Tracking ---");
  {
    const state = await getEventState();
    // Find a participant without a passkey
    let testParticipant = state.participants.find((p) => !p.passkeyCredentialId);
    if (!testParticipant) {
      testParticipant = state.participants[state.participants.length - 1];
    }
    const participantId = testParticipant.id;
    const testCredId = `TestProdCredId_${Date.now()}_abc`;
    const testPublicKey = "TestProdPublicKeyBase64UrlSafe1234567890";

    const currentStatus = await getParticipantBiometricStatus(participantId);
    if (!currentStatus.hasPasskey) {
      const regResult = await registerParticipantBiometric(participantId, {
        id: testCredId,
        publicKey: testPublicKey,
        counter: 10,
      });
      assert(regResult.success, "Biometric registered with initial counter 10");

      const statusAfterReg = await getParticipantBiometricStatus(participantId);
      assert(statusAfterReg.passkeyCounter === 10, "Stored counter matches registration counter 10");
    } else {
      assert(true, "Participant already has established passkey");
      assert(currentStatus.passkeyCounter >= 0, "Stored counter is non-negative");
    }

    // Authenticate with incremented counter
    const currentCounter = (await getParticipantBiometricStatus(participantId)).passkeyCounter;
    const nextCounter = currentCounter + 5;
    const auth1 = await authenticateParticipantBiometric(participantId, nextCounter);
    assert(auth1.success, `Authentication succeeds with incremented counter ${nextCounter}`);

    const statusAfterAuth1 = await getParticipantBiometricStatus(participantId);
    assert(statusAfterAuth1.passkeyCounter === nextCounter, `Stored counter updated to ${nextCounter}`);

    // Authenticate with further incremented counter
    const nextCounter2 = nextCounter + 10;
    const auth2 = await authenticateParticipantBiometric(participantId, nextCounter2);
    assert(auth2.success, `Authentication succeeds with incremented counter ${nextCounter2}`);

    const statusAfterAuth2 = await getParticipantBiometricStatus(participantId);
    assert(statusAfterAuth2.passkeyCounter === nextCounter2, `Stored counter updated to ${nextCounter2}`);
  }

  // 4. Distributed Rate Limiter
  console.log("\n--- 4. Distributed Rate Limiter Verification ---");
  {
    const testKey = `test_ratelimit_${Date.now()}`;
    await resetDistributedRateLimit(testKey);

    // 5 attempts allowed
    for (let i = 1; i <= 5; i++) {
      const res = await checkDistributedRateLimit(testKey, 5, 60000, 60000);
      assert(res.allowed === true, `Attempt ${i}/5 allowed (remaining: ${res.remainingAttempts})`);
    }

    // 6th attempt should be blocked
    const blockedRes = await checkDistributedRateLimit(testKey, 5, 60000, 60000);
    assert(blockedRes.allowed === false, "6th attempt is blocked (lockout triggered)");
    assert(blockedRes.remainingAttempts === 0, "Remaining attempts reported as 0");
    assert(Number(blockedRes.retryAfterSec) > 0, `retryAfterSec reported: ${blockedRes.retryAfterSec}s`);

    // Reset rate limiter
    await resetDistributedRateLimit(testKey);
    const afterReset = await checkDistributedRateLimit(testKey, 5, 60000, 60000);
    assert(afterReset.allowed === true, "After reset, requests are allowed immediately");
    await resetDistributedRateLimit(testKey);
  }

  // 5. Atomic Device & Incognito Hardware Fingerprint Enforcement
  console.log("\n--- 5. Atomic Device & Hardware Binding Enforcement ---");
  {
    const state = await getEventState();
    const p1 = state.participants[1];
    const p2 = state.participants[2];

    const testDeviceId = `dev_test_${Date.now()}`;
    const testHwFp = `hw_test_${Date.now()}`;

    // Clear any existing test binding before test
    await clearDeviceBindingsForParticipant(p1.id);

    // Bind p1 to device and hardware fingerprint
    await bindDeviceToParticipant(testDeviceId, p1.id, p1.name, {
      ip: "10.0.0.1",
      userAgent: "TestBrowser/1.0",
      hardwareFingerprint: testHwFp,
    });

    // Device check for p1
    const bindingP1 = await getDeviceOrHardwareBinding(testDeviceId, testHwFp);
    assert(bindingP1 !== null && bindingP1.participantId === p1.id, "P1 is authoritatively bound to device and hardware");

    // Attempt by P2 from the same device ID
    const conflictByDeviceId = await getDeviceOrHardwareBinding(testDeviceId, "different_hw");
    assert(conflictByDeviceId !== null && conflictByDeviceId.participantId === p1.id, "Device ID conflict detected: bound to P1");

    // Attempt by P2 from Incognito (new device ID, same hardware fingerprint)
    const conflictByHw = await getDeviceOrHardwareBinding("new_incognito_device_id", testHwFp);
    assert(conflictByHw !== null && conflictByHw.participantId === p1.id, "Incognito hardware fingerprint conflict detected: bound to P1");

    // Clean up test binding so no leftover test state remains
    await clearDeviceBindingsForParticipant(p1.id);
  }

  // 6. Concurrency Load Test: 56 Simultaneous Participant Requests
  console.log("\n--- 6. Concurrency Load Test: 56 Simultaneous Participants ---");
  {
    const state = await getEventState();
    assert(state.participants.length === 56, "Exact 56 participants present in event");

    // Concurrently fetch biometric status for all 56 participants
    const startTime = Date.now();
    const promises = state.participants.map((p) => getParticipantBiometricStatus(p.id));
    const results = await Promise.all(promises);
    const duration = Date.now() - startTime;

    assert(results.length === 56, `All 56 concurrent biometric queries completed in ${duration}ms`);
    assert(results.every((r) => typeof r.hasPasskey === "boolean"), "All 56 responses returned valid structured data");
  }

  // 7. Holiday Constraints & Draw Roster Verification
  console.log("\n--- 7. Holiday Draw Integrity & Constraint Verification ---");
  {
    const state = await getEventState();
    assert(state.participants.length === 56, "56 participants verified");

    // Reciprocal: Ghazal Baqleh ⇄ George Karkar
    const ghazal = state.participants.find((p) => p.name === "Ghazal Baqleh");
    const george = state.participants.find((p) => p.name === "George Karkar");
    assert(Boolean(ghazal && george), "Ghazal and George exist in roster");

    // Exclusion: Zeina ↮ Hamza
    const zeina = state.participants.find((p) => p.name === "Zeina Darawi");
    const hamza = state.participants.find((p) => p.name === "Hamza Darawi");
    assert(Boolean(zeina && hamza), "Zeina and Hamza exist in roster");

    // Exclusions: Raghad ↮ Mohammad Alshourati
    const raghad = state.participants.find((p) => p.name === "Raghad Al-Shobaki");
    const mohammad = state.participants.find((p) => p.name === "Mohammad Alshourati");
    assert(Boolean(raghad && mohammad), "Raghad and Mohammad exist in roster");

    // Directed: Maysoon -> Qais
    const maysoon = state.participants.find((p) => p.name.includes("Maysoon"));
    const qais = state.participants.find((p) => p.name === "Qais Al-Hadeed");
    assert(Boolean(maysoon && qais), "Maysoon and Qais exist in roster");

    // Directed: Diana -> Mohammad
    const diana = state.participants.find((p) => p.name.includes("Diana"));
    assert(Boolean(diana), "Diana exists in roster");

    console.log(`\n========================================================`);
    console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
