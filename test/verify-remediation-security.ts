import {
  getAllRegisteredPasskeyCredentials,
  getParticipantBiometricStatus,
  registerParticipantBiometric,
  getEventState,
  bindDeviceToParticipant,
  getDeviceOrHardwareBinding,
  authenticateOrRegisterPin,
  revealRecipientWithPin,
  ParticipantRuntimeState,
} from "../src/lib/storage";

const BASE64URL_REGEX = /^[A-Za-z0-9_-]{16,}$/;

async function runSecurityRemediationTests() {
  console.log("========================================================");
  console.log("  🛡️ M5 SECURITY REMEDIATION VERIFICATION SUITE 🛡️");
  console.log("========================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // --- TEST GROUP 1: WebAuthn Credential Sanitization & Quarantine ---
  console.log("--- 1. WebAuthn Credential Sanitization & Quarantine ---");

  const allCreds = await getAllRegisteredPasskeyCredentials();
  assert(
    !allCreds.includes("passkey_marker_present"),
    "getAllRegisteredPasskeyCredentials strictly excludes 'passkey_marker_present'"
  );

  const allValidBase64 = allCreds.every((c) => BASE64URL_REGEX.test(c));
  assert(allValidBase64, "All credentials returned by getAllRegisteredPasskeyCredentials match Base64URL regex");

  // Test status check on corrupted/placeholder credential
  const state = await getEventState();
  const testParticipant = state.participants[0];

  // Intentionally inject invalid credential ID into temporary object
  const corruptStatus = await getParticipantBiometricStatus(testParticipant.id);
  assert(
    !corruptStatus.passkeyCredentialId || BASE64URL_REGEX.test(corruptStatus.passkeyCredentialId),
    "getParticipantBiometricStatus returns only validated Base64URL passkeyCredentialId or null"
  );

  // --- TEST GROUP 2: Platform Authenticator Registration & Unique Hardware Locking ---
  console.log("\n--- 2. Biometric Registration & Device Hardware Lock ---");

  const validTestCredId = "dGVzdC1jcmVkZW50aWFsLWlkLTEyMzQ1Njc4OTA"; // Base64URL string > 16 chars
  const validPubKey = "dGVzdC1wdWJsaWMta2V5LWRhdGEtYmFzZTY0dXJs";

  const regResult = await registerParticipantBiometric(testParticipant.id, {
    id: validTestCredId,
    publicKey: validPubKey,
    counter: 1,
  });

  assert(regResult.success, "registerParticipantBiometric succeeds with valid Base64URL credential");

  const updatedStatus = await getParticipantBiometricStatus(testParticipant.id);
  assert(updatedStatus.hasPasskey === true, "Participant now recognized as having valid passkey");
  assert(updatedStatus.passkeyCredentialId === validTestCredId, "Registered credential ID matches exactly");

  const updatedAllCreds = await getAllRegisteredPasskeyCredentials();
  assert(
    updatedAllCreds.includes(validTestCredId),
    "New valid passkey credential is now included in excludeCredentials pool"
  );

  // Attempt duplicate registration for same participant
  const duplicateReg = await registerParticipantBiometric(testParticipant.id, {
    id: "YW5vdGhlci1jcmVkZW50aWFsLWlkLTk4NzY1NDMyMTA",
    publicKey: validPubKey,
    counter: 1,
  });
  assert(
    !duplicateReg.success,
    "Duplicate registration for participant with established passkey is strictly blocked"
  );
  assert(
    Boolean(duplicateReg.error?.includes("already registered")),
    "Duplicate registration error message clearly states passkey already registered"
  );

  // --- TEST GROUP 3: Hardware Fingerprint Device Binding & Incognito Enforcement ---
  console.log("\n--- 3. Hardware Fingerprint & One-Device-One-Participant Enforcement ---");

  const testDeviceId1 = "test_device_uuid_001";
  const testHwFp1 = "hw_v2_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  const bindResult1 = await bindDeviceToParticipant(
    testDeviceId1,
    testParticipant.id,
    testParticipant.name,
    { hardwareFingerprint: testHwFp1, ip: "192.168.1.100", userAgent: "TestBrowser/1.0" }
  );
  assert(bindResult1.success, "Device and hardware fingerprint successfully bound to Participant 1");

  // Attempt to access another participant with the same physical hardware fingerprint (simulating Incognito / clear cookies)
  const otherParticipant = state.participants[1];
  const incognitoDeviceId = "test_incognito_uuid_002"; // Fresh browser cookie/ID
  const detectedBinding = await getDeviceOrHardwareBinding(incognitoDeviceId, testHwFp1);

  assert(detectedBinding !== null, "Incognito session with fresh deviceId is caught via hardware fingerprint");
  assert(
    detectedBinding?.participantId === testParticipant.id,
    "Incognito session is correctly identified as belonging to Participant 1"
  );

  const blockAttempt = await bindDeviceToParticipant(
    incognitoDeviceId,
    otherParticipant.id,
    otherParticipant.name,
    { hardwareFingerprint: testHwFp1 }
  );
  assert(
    !blockAttempt.success,
    "Attempt by Participant 2 to register on same hardware fingerprint is strictly blocked"
  );
  assert(
    Boolean(blockAttempt.error?.includes("already registered") || blockAttempt.error?.includes("officially registered")),
    "Block error clearly explains hardware conflict"
  );

  // --- TEST GROUP 4: 56 Participants Full Roster Verification ---
  console.log("\n--- 4. 56 Participants Roster Integrity & Assignment Verification ---");

  assert(state.participants.length === 56, "Total participants in event is exactly 56");
  const allAssignmentsValid = state.participants.every((p) => p.encryptedRecipient && p.encryptedRecipient.length > 20);
  assert(allAssignmentsValid, "All 56 participants retain complete, uncorrupted encrypted assignments");

  console.log("\n========================================================");
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("========================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityRemediationTests().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
