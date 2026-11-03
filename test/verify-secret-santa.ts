import fs from "fs";
import path from "path";
import { PARTICIPANTS } from "../src/lib/constants";
import {
  generateConstrainedSecretSantaDraw,
  validateConstrainedSecretSantaDraw,
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
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
  const v5p = path.join(testDir, "v5_participants");
  const v5rev = path.join(testDir, "v5_revealed");
  const v5reg = path.join(testDir, "v5_registered");
  if (fs.existsSync(v5p)) fs.rmSync(v5p, { recursive: true, force: true });
  if (fs.existsSync(v5rev)) fs.rmSync(v5rev, { recursive: true, force: true });
  if (fs.existsSync(v5reg)) fs.rmSync(v5reg, { recursive: true, force: true });

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
  assert(state.version === 5, "Event round version is 5");

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
  const round5Secret = "SantaMagic2024_Round5_SecureTokenKey_v5";
  const oldSecret = "SantaFinalSecret2024Key!_SafeHolidayToken_v3";

  // Token created with round 5 secret validates
  const validToken = createSessionToken("p1", round5Secret);
  const verified = verifySessionToken(validToken, round5Secret);
  assert(verified?.participantId === "p1", "Valid Round 5 session token verifies participant ID");

  // Token created with previous round secret is REJECTED
  const oldToken = createSessionToken("p1", oldSecret);
  const oldVerified = verifySessionToken(oldToken, round5Secret);
  assert(oldVerified === null, "Previous-round session token is rejected in Round 5");

  // Tampered token is rejected
  const tamperedToken = validToken.substring(0, validToken.length - 4) + "XXXX";
  assert(verifySessionToken(tamperedToken, round5Secret) === null, "Tampered session token is rejected");

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
