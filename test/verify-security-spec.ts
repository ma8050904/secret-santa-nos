import { PARTICIPANTS } from "../src/lib/constants";
import {
  setBoundParticipantCookie,
  verifyBoundParticipant,
  setBiometricChallengeCookie,
  verifyBiometricChallengeCookie,
} from "../src/lib/session";
import {
  getParticipantBiometricStatus,
  authenticateOrRegisterPin,
  getDeviceOrHardwareBinding,
  bindDeviceToParticipant,
} from "../src/lib/storage";
import { getPostgresEventState, getPostgresDeviceOrHardwareBinding } from "../src/lib/db";
import { NextRequest, NextResponse } from "next/server";

async function runTests() {
  console.log("=================================================");
  console.log("RUNNING SECRET SANTA SECURITY VERIFICATION SUITE");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: Signed Cookie Binding and Verification
  // --------------------------------------------------------------------------
  try {
    const mockRes = {
      cookies: {
        store: new Map<string, string>(),
        set(name: string, value: string) {
          this.store.set(name, value);
        },
      },
    };
    setBoundParticipantCookie(mockRes as any, "p33");
    const rawCookie = mockRes.cookies.store.get("ss_bound_participant");
    assert(Boolean(rawCookie && rawCookie.startsWith("p33.")), "Cookie set with HMAC-SHA256 signature");

    const verifiedId = verifyBoundParticipant(rawCookie);
    assert(verifiedId === "p33", "verifyBoundParticipant validates authentic signature correctly");

    const tampered = verifyBoundParticipant("p34." + rawCookie?.split(".")[1]);
    assert(tampered === null, "verifyBoundParticipant rejects tampered participantId (signature mismatch)");

    const invalid = verifyBoundParticipant("not-a-valid-cookie");
    assert(invalid === null, "verifyBoundParticipant rejects malformed cookie strings");
  } catch (err) {
    assert(false, "Test 1 Cookie verification exception", String(err));
  }

  // --------------------------------------------------------------------------
  // TEST 2: HMAC-SHA256 WebAuthn Challenge Cookie Binding
  // --------------------------------------------------------------------------
  try {
    const mockRes = {
      cookies: {
        store: new Map<string, string>(),
        set(name: string, value: string) {
          this.store.set(name, value);
        },
      },
    };
    const challenge = "test_challenge_nonce_xyz123";
    setBiometricChallengeCookie(mockRes as any, "authenticate", challenge, "p33");
    const challengeCookieVal = mockRes.cookies.store.get("santa_biometric_challenge");
    assert(Boolean(challengeCookieVal), "Challenge cookie generated and stored");

    const mockReq = {
      cookies: {
        get(name: string) {
          if (name === "santa_biometric_challenge") {
            return { value: challengeCookieVal };
          }
          return undefined;
        },
      },
    } as unknown as NextRequest;

    const validChallenge = verifyBiometricChallengeCookie(mockReq, "authenticate", "p33");
    assert(validChallenge === challenge, "Challenge cookie verifies correctly with matching mode and participant");

    const wrongMode = verifyBiometricChallengeCookie(mockReq, "register", "p33");
    assert(wrongMode === null, "Challenge cookie fails verification when expectedMode mismatches (register vs auth)");

    const wrongParticipant = verifyBiometricChallengeCookie(mockReq, "authenticate", "p34");
    assert(wrongParticipant === null, "Challenge cookie fails verification when participantId mismatches");
  } catch (err) {
    assert(false, "Test 2 Challenge verification exception", String(err));
  }

  // --------------------------------------------------------------------------
  // TEST 3: Immutable Claim State Invariant
  // --------------------------------------------------------------------------
  try {
    // Participant p33 (Mohammad Alshourati) is already claimed in the DB
    const status = await getParticipantBiometricStatus("p33");
    assert(status.isClaimed === true, "Participant p33 is identified as isClaimed: true");
    assert(status.hasPin === true, "Participant p33 hasPin is verified true");

    // Attempting to overwrite PIN on already claimed participant
    const overwriteAttempt = await authenticateOrRegisterPin("p33", "9999");
    assert(
      overwriteAttempt.success === false &&
        (overwriteAttempt.error?.includes("Incorrect PIN") || overwriteAttempt.error?.includes("already been claimed")),
      "PIN overwrite / registration on already claimed participant is blocked"
    );
  } catch (err) {
    assert(false, "Test 3 Claim state exception", String(err));
  }

  // --------------------------------------------------------------------------
  // TEST 4: No Collision Between Identical iPhone Models Sharing Hardware Fingerprint
  // --------------------------------------------------------------------------
  try {
    // Both Student A and Student B have identical iPhone 13s generating the exact same hardware_fingerprint
    const sharedIPhoneHwFp = "hw_v3_956a556d2039d6b5a1511ebc4295077c785f2482eb12b9f608b0394cd2cd55e8";

    // Student A's bound deviceId: '5919a1b9-89fc-45fb-862a-27b823ea71c8'
    const studentADeviceBinding = await getDeviceOrHardwareBinding("5919a1b9-89fc-45fb-862a-27b823ea71c8", sharedIPhoneHwFp);
    assert(
      studentADeviceBinding !== null && studentADeviceBinding.participantId === "p33",
      "Student A is correctly recognized by their unique device_id"
    );

    // Student B has a different device_id, but the exact same iPhone hardware_fingerprint
    const studentBNewDeviceId = "student-b-iphone-uuid-12345";
    const studentBDeviceBinding = await getDeviceOrHardwareBinding(studentBNewDeviceId, sharedIPhoneHwFp);
    assert(
      studentBDeviceBinding === null,
      "Student B with a new device_id is NOT falsely bound to Student A despite identical iPhone hardware fingerprint"
    );
  } catch (err) {
    assert(false, "Test 4 Hardware Fingerprint collision test exception", String(err));
  }

  // --------------------------------------------------------------------------
  // TEST 5: Real-time Event State & 56 Participants Preservation
  // --------------------------------------------------------------------------
  try {
    const pgState = await getPostgresEventState();
    assert(
      pgState !== null && pgState.participants.length === 56,
      `All 56 participants preserved in PostgreSQL (count: ${pgState?.participants.length})`
    );

    const mohammad = pgState?.participants.find((p) => p.id === "p33");
    assert(
      mohammad !== undefined && Boolean(mohammad.isRevealed),
      "Real-time reveal state for Mohammad Alshourati correctly merged from event_participants table"
    );
  } catch (err) {
    assert(false, "Test 5 Database preservation exception", String(err));
  }

  console.log("\n=================================================");
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("FATAL SUITE ERROR:", err);
  process.exit(1);
});
