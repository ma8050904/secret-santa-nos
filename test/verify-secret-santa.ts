import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { PARTICIPANTS } from "../src/lib/constants";
import {
  generateConstrainedSecretSantaDraw,
  validateConstrainedSecretSantaDraw,
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
  TARGET_RECIPIENT,
  TARGET_ALLOWED_GIVERS,
} from "../src/lib/derangement";
import {
  hashPin,
  verifyPin,
  generateRandomSalt,
  encryptRecipient,
  decryptRecipient,
  createSessionToken,
  verifySessionToken,
} from "../src/lib/crypto";
import {
  getEventState,
  authenticateOrRegisterPin,
  revealRecipientWithPin,
  getAdminSafeState,
} from "../src/lib/storage";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${testName} - ${detail || "Assertion failed"}`);
    failedCount++;
  }
}

const EXPECTED_48_NAMES = [
  "Elean Nshewat",
  "George Karkar",
  "George Shammas",
  "Ghazal Baqleh",
  "Hala Ahmad",
  "Hala Shaheen",
  "Hamza Ahmad",
  "Hamza Darawi",
  "Ibrahim Hanin",
  "Ibrahim Jahshan",
  "Issa Hijazeen",
  "Joelle Al-Dallou",
  "Joewelle Ehab",
  "Joseph Dababneh",
  "Jude Fanous",
  "Karam Abu Hamdan",
  "Kerolos Esrael",
  "Katia Majrouh",
  "Khalil Dabit",
  "Leya Al-Khatib",
  "Malak Malek",
  "Malak Hindaileh",
  "Maria Halaseh",
  "Mariana Salkawi",
  "Maya Joy Mahrejian",
  "Michael Shamma",
  "Mohammad Darras",
  "Mohammad Shourati",
  "Nardeen Abdallah",
  "Natalie Khacherian",
  "Nishan Nodiznaya",
  "Omar Batshoun",
  "Omar Fakhoury",
  "Qais Al-Hadeed",
  "Raghad Al-Shobaki",
  "Sanad Al-Hunaiti",
  "Sarah Rabadi",
  "Suhail Haddad",
  "Tala Bouri",
  "Toleen Awwad",
  "Wasan Abu Hamdeh",
  "Yara Barjawi",
  "Yousef Jahshan",
  "Yousef Rabadi",
  "Zaid Al-Helu",
  "Zaid Al-Lataifeh",
  "Zaid Al-Louh",
  "Zeina Darawi",
];

async function runTests() {
  const testFile = process.env.STORAGE_FILE_PATH || "/tmp/test-secret-santa.json";
  if (fs.existsSync(testFile)) fs.rmSync(testFile, { force: true });
  const testDir = path.dirname(testFile);
  for (const prefix of ["v5_", "v6_"]) {
    for (const sub of ["participants", "revealed", "registered"]) {
      const d = path.join(testDir, `${prefix}${sub}`);
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  }

  console.log("\n========================================================");
  console.log("  🎄 SECRET SANTA – AUDIT & INTEGRITY VERIFICATION 🎄");
  console.log("========================================================\n");

  // =========================================================================
  // SUITE A: ROSTER INTEGRITY (48 Participants)
  // =========================================================================
  console.log("--- A. Participant Roster Integrity ---");
  assert(PARTICIPANTS.length === 48, "Exact participant count is 48");

  const actualNames = PARTICIPANTS.map((p) => p.name);
  const uniqueNames = new Set(actualNames);
  assert(uniqueNames.size === 48, "All 48 participant names are unique");

  const allNamesMatch = EXPECTED_48_NAMES.every((name, idx) => actualNames[idx] === name);
  assert(allNamesMatch, "All 48 participant names match exact spelling and capitalization in order");

  // =========================================================================
  // SUITE B: DRAW CONSTRAINTS & CRYPTOGRAPHIC STORAGE
  // =========================================================================
  console.log("\n--- B. Constrained Draw Integrity ---");
  const state = await getEventState();
  assert(state.participants.length === 48, "Storage contains all 48 participants");
  assert(state.status === "active", "Event draw remains in active status");
  assert(state.version === 6, "Event round version is 6");

  const allHaveAssignments = state.participants.every(
    (p) => typeof p.encryptedRecipient === "string" && p.encryptedRecipient.length > 0
  );
  assert(allHaveAssignments, "All 48 participants have valid encrypted assignments");

  // Decrypt all assignments to test constraints
  const decryptedMap = new Map<string, string>();
  for (const p of state.participants) {
    const dec = decryptRecipient(p.encryptedRecipient!, p.code, state.masterSalt);
    decryptedMap.set(p.name, dec);
  }

  // 1. Bijection check
  assert(decryptedMap.size === 48, "Exactly 48 givers present in draw");
  const recipientSet = new Set(decryptedMap.values());
  assert(recipientSet.size === 48, "Exactly 48 unique recipients present in draw");

  // 2. Zero self-assignments
  const selfAssignments = Array.from(decryptedMap.entries()).filter(([giver, rec]) => giver === rec);
  assert(selfAssignments.length === 0, "Zero self-assignments exist in draw");

  // 3. Mandatory reciprocal: Ghazal Baqleh <-> George Karkar
  const ghazalRecipient = decryptedMap.get(MANDATORY_RECIPROCAL_A);
  const georgeRecipient = decryptedMap.get(MANDATORY_RECIPROCAL_B);
  assert(
    ghazalRecipient === MANDATORY_RECIPROCAL_B && georgeRecipient === MANDATORY_RECIPROCAL_A,
    `Mandatory reciprocal assignment verified: ${MANDATORY_RECIPROCAL_A} ⇄ ${MANDATORY_RECIPROCAL_B}`
  );

  // 4. Mandatory exclusion: Zeina Darawi <-> Hamza Darawi
  const zeinaRecipient = decryptedMap.get(FORBIDDEN_EXCLUSION_A);
  const hamzaRecipient = decryptedMap.get(FORBIDDEN_EXCLUSION_B);
  assert(
    zeinaRecipient !== FORBIDDEN_EXCLUSION_B && hamzaRecipient !== FORBIDDEN_EXCLUSION_A,
    `Mandatory exclusion verified: ${FORBIDDEN_EXCLUSION_A} and ${FORBIDDEN_EXCLUSION_B} are NOT assigned to each other`
  );

  // 5. Mandatory Constraint 3: Who Receives Mohammad Shourati
  const shouratiGiver = Array.from(decryptedMap.entries()).find(([_, rec]) => rec === TARGET_RECIPIENT)?.[0];
  assert(
    typeof shouratiGiver === "string" && (TARGET_ALLOWED_GIVERS as readonly string[]).includes(shouratiGiver),
    `Mandatory Constraint 3 verified: Mohammad Shourati's giver is one of the 11 allowed participants (${shouratiGiver})`
  );
  const shouratiRecipientCount = Array.from(decryptedMap.values()).filter((r) => r === TARGET_RECIPIENT).length;
  assert(shouratiRecipientCount === 1, "Exactly one participant receives Mohammad Shourati");
  const shouratiOwnRecipient = decryptedMap.get(TARGET_RECIPIENT);
  assert(shouratiOwnRecipient !== TARGET_RECIPIENT, "Mohammad Shourati is not self-assigned");

  // =========================================================================
  // SUITE C: CRYPTOGRAPHIC PIN HASHING & SALT SECURITY
  // =========================================================================
  console.log("\n--- C. Cryptographic PIN Hashing & Salt Security ---");
  const testPin = "7492";
  const salt1 = generateRandomSalt();
  const salt2 = generateRandomSalt();

  const hash1 = hashPin(testPin, salt1);
  const hash2 = hashPin(testPin, salt2);

  assert(hash1 !== hash2, "Unique salts generate completely distinct hashes for same PIN");
  assert(verifyPin(testPin, hash1, salt1) === true, "Valid PIN verifies successfully");
  assert(verifyPin("0000", hash1, salt1) === false, "Incorrect PIN is rejected");

  // =========================================================================
  // SUITE D: SINGLE-FIELD PIN REGISTRATION & AUTHENTICATION
  // =========================================================================
  console.log("\n--- D. Single-Field PIN Registration & Authentication ---");
  const p1 = state.participants.find((p) => p.id === "p1")!;

  // Short PIN rejected
  const shortResult = await authenticateOrRegisterPin("p1", "12");
  assert(!shortResult.success, "PIN shorter than 4 characters is rejected");

  // First-time registration with single PIN entry
  const firstReg = await authenticateOrRegisterPin("p1", "5829");
  assert(firstReg.success === true, "First-time participant establishes PIN with 1 field entry");
  assert(firstReg.isNewRegistration === true, "Recognized as first-time registration");

  // Subsequent visit with SAME PIN
  const returningLogin = await authenticateOrRegisterPin("p1", "5829");
  assert(returningLogin.success === true, "Returning participant logs in with established PIN");
  assert(returningLogin.isNewRegistration === false, "Recognized as returning participant");

  // Subsequent visit with WRONG PIN
  const wrongLogin = await authenticateOrRegisterPin("p1", "9999");
  assert(!wrongLogin.success, "Login with wrong PIN is rejected");

  // =========================================================================
  // SUITE E: REVEAL EXPERIENCE & IDEMPOTENCY
  // =========================================================================
  console.log("\n--- E. Reveal Experience & Idempotency ---");
  // Reveal attempt with wrong PIN blocked
  const wrongReveal = await revealRecipientWithPin("p1", "9999");
  assert(!wrongReveal.success, "Reveal attempt with incorrect PIN strictly blocked");

  // Authorized reveal
  const reveal1 = await revealRecipientWithPin("p1", "5829");
  assert(reveal1.success === true, "Authorized participant reveals secret recipient");
  assert(typeof reveal1.recipientName === "string" && reveal1.recipientName.length > 0, "Recipient revealed");
  assert(reveal1.recipientName !== p1.name, "Recipient is not the participant themselves");
  assert(reveal1.isFirstReveal === true, "First reveal correctly marked");

  // Idempotent reveal revisit
  const reveal2 = await revealRecipientWithPin("p1", "5829");
  assert(reveal2.success === true, "Participant can revisit secret result");
  assert(reveal2.recipientName === reveal1.recipientName, "Revisit returns identical recipient");
  assert(reveal2.isFirstReveal === false, "Revisit correctly marked as subsequent visit");

  // =========================================================================
  // SUITE F: CROSS-PARTICIPANT ISOLATION
  // =========================================================================
  console.log("\n--- F. Cross-Participant Isolation ---");
  const p2 = state.participants.find((p) => p.id === "p2")!;
  const p2WrongAuth = await authenticateOrRegisterPin("p2", "5829"); // p1's PIN on p2 before p2 registers
  // p2 is unregistered, so entering a PIN registers it for p2
  const p2RevealWithP1Pin = await revealRecipientWithPin("p2", "0000"); // wrong PIN for p2
  assert(!p2RevealWithP1Pin.success, "Participant 2 cannot be unlocked with incorrect PIN");

  const p2CorrectReveal = await revealRecipientWithPin("p2", "5829");
  assert(p2CorrectReveal.success === true, "Participant 2 reveals own secret recipient");
  assert(p2CorrectReveal.recipientName !== p2.name, "Participant 2 recipient is not themselves");
  assert(p2CorrectReveal.recipientName !== reveal1.recipientName, "Participant 2 received distinct recipient");

  // =========================================================================
  // SUITE G: SESSION SECURITY & ROUND INVALIDATION
  // =========================================================================
  console.log("\n--- G. Session Security & Round Invalidation ---");
  const round6FreshSecret = "SantaMagic2024_Round6_PinResetTokenKey_v6_fresh";
  const preResetRound6Secret = "SantaMagic2024_Round6_SecureTokenKey_v6";
  const round5Secret = "SantaMagic2024_Round5_SecureTokenKey_v5";

  // Token created with fresh round 6 secret validates
  const validToken = createSessionToken("p1", round6FreshSecret);
  const verified = verifySessionToken(validToken, round6FreshSecret);
  assert(verified?.participantId === "p1", "Valid Round 6 session token verifies participant ID");

  // Token created with pre-reset round 6 secret is REJECTED
  const preResetToken = createSessionToken("p1", preResetRound6Secret);
  const preResetVerified = verifySessionToken(preResetToken, round6FreshSecret);
  assert(preResetVerified === null, "Pre-reset Round 6 session token is rejected after PIN reset");

  // Token created with previous round secret (Round 5) is REJECTED
  const oldToken = createSessionToken("p1", round5Secret);
  const oldVerified = verifySessionToken(oldToken, round6FreshSecret);
  assert(oldVerified === null, "Previous Round 5 session token is rejected in Round 6");

  // Tampered token is rejected
  const tamperedToken = validToken.substring(0, validToken.length - 4) + "XXXX";
  assert(verifySessionToken(tamperedToken, round6FreshSecret) === null, "Tampered session token is rejected");

  // =========================================================================
  // SUITE H: CONCURRENCY LOAD TEST (Simulating 48 concurrent participants)
  // =========================================================================
  console.log("\n--- H. Concurrency Load Test (Simulating 48 Concurrent Users) ---");

  // 1. 48 Simultaneous directory read requests
  console.log("  Testing 48 simultaneous directory read requests...");
  const t0 = Date.now();
  const readResults = await Promise.all(
    Array.from({ length: 48 }).map(async () => {
      const s = await getEventState();
      return s.participants.length === 48;
    })
  );
  const readDuration = Date.now() - t0;
  assert(
    readResults.every(Boolean),
    `All 48 simultaneous read requests succeeded (${readDuration}ms total)`
  );

  // 2. 46 Simultaneous first-time PIN registrations (p3 through p48)
  console.log("  Testing 46 simultaneous independent PIN registrations...");
  const registrationPromises = state.participants.slice(2).map(async (p, idx) => {
    const pin = `1000${idx + 3}`;
    const res = await authenticateOrRegisterPin(p.id, pin);
    return { id: p.id, success: res.success, isNew: res.isNewRegistration };
  });

  const regResults = await Promise.all(registrationPromises);
  const allRegSuccess = regResults.every((r) => r.success && r.isNew);
  assert(allRegSuccess, "All 46 concurrent PIN registrations succeeded with zero lost updates");

  // 3. 46 Simultaneous reveals across all participants
  console.log("  Testing 46 simultaneous independent reveal operations...");
  const revealPromises = state.participants.slice(2).map(async (p, idx) => {
    const pin = `1000${idx + 3}`;
    const res = await revealRecipientWithPin(p.id, pin);
    return {
      id: p.id,
      success: res.success,
      hasRecipient: typeof res.recipientName === "string",
      recipient: res.recipientName,
    };
  });

  const revResults = await Promise.all(revealPromises);
  const allRevSuccess = revResults.every((r) => r.success && r.hasRecipient);
  assert(allRevSuccess, "All 46 concurrent reveal operations succeeded with zero errors");

  // Verify that all 48 recipients match the original decrypted draw exactly
  let assignmentsIntact = true;
  for (const r of revResults) {
    const expected = decryptedMap.get(state.participants.find((p) => p.id === r.id)!.name);
    if (r.recipient !== expected) {
      assignmentsIntact = false;
      break;
    }
  }
  assert(assignmentsIntact, "All revealed recipients match original draw with 100% data integrity");

  // 4. Repeated concurrent requests & network retries
  console.log("  Testing concurrent duplicate submissions and idempotency...");
  const duplicatePromises = Array.from({ length: 10 }).map(async () => {
    return await revealRecipientWithPin("p3", "10003");
  });
  const duplicateResults = await Promise.all(duplicatePromises);
  const allDuplicateSuccess = duplicateResults.every((r) => r.success && !r.isFirstReveal);
  assert(allDuplicateSuccess, "Repeated concurrent requests to same participant are completely idempotent");

  // =========================================================================
  // SUITE I: ORGANIZER-BLIND PRIVACY & AUDIT
  // =========================================================================
  console.log("\n--- I. Organizer-Blind Privacy Audit ---");
  const adminState = await getAdminSafeState();
  assert(adminState.totalParticipants === 48, "Organizer sees exactly 48 participants");
  assert(adminState.registeredCount === 48, "All 48 participants tracked as registered");
  assert(adminState.revealedCount === 48, "All 48 participants tracked as revealed");

  // Strictly verify privacy: no PINs, salts, or recipients in admin state
  const leakedData = adminState.participants.some(
    (p: any) =>
      typeof p.encryptedRecipient !== "undefined" ||
      typeof p.pinHash !== "undefined" ||
      typeof p.code !== "undefined" ||
      typeof p.recipientName !== "undefined"
  );
  assert(!leakedData, "CRITICAL PRIVACY GATE: Admin state strictly omits PINs, hashes, and recipient mappings");

  // =========================================================================
  // SUITE J: PARTICIPANT SESSION LOCK & IDENTITY PROTECTION
  // =========================================================================
  console.log("\n--- J. Participant Session Lock & Identity Protection ---");
  const { POST: pinRoute } = await import("../src/app/api/auth/pin/route");
  const { POST: revealRoute } = await import("../src/app/api/reveal/route");

  function createMockRequest(url: string, body: any, sessionParticipantId?: string) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sessionParticipantId) {
      const token = createSessionToken(sessionParticipantId, round6FreshSecret);
      headers["cookie"] = `santa_participant_session=${token}`;
    }
    return new NextRequest(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  // 1. Participant attempting to authenticate as another participant within active session
  const switchReq = createMockRequest(
    "http://localhost:3000/api/auth/pin",
    { participantId: "p2", pin: "5829" },
    "p1" // session belongs to p1
  );
  const switchRes = await pinRoute(switchReq);
  const switchData = await switchRes.json();
  assert(switchRes.status === 403, "Attempt to switch participant identity within active session is blocked with HTTP 403");
  assert(
    !switchData.error?.includes("log out"),
    "Session lock error message does NOT contain 'log out'"
  );
  assert(
    switchData.error?.includes("locked"),
    "Session lock error message explicitly states session is locked"
  );

  // 2. Participant attempting to reveal another participant's recipient within active session
  const crossRevealReq = createMockRequest(
    "http://localhost:3000/api/reveal",
    { participantId: "p2", pin: "5829" },
    "p1" // session belongs to p1
  );
  const crossRevealRes = await revealRoute(crossRevealReq);
  assert(crossRevealRes.status === 403, "Attempt to reveal another participant's gift within active session is blocked with HTTP 403");

  // 3. Separate independent browser / device without session cookie can authenticate independently
  const separateDeviceReq = createMockRequest(
    "http://localhost:3000/api/auth/pin",
    { participantId: "p2", pin: "5829" }
    // No session cookie
  );
  const separateDeviceRes = await pinRoute(separateDeviceReq);
  const separateDeviceData = await separateDeviceRes.json();
  assert(separateDeviceRes.status === 200 && separateDeviceData.success === true, "Separate device without session cookie authenticates independently");

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log("\n========================================================");
  console.log(`  VERIFICATION RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("========================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
