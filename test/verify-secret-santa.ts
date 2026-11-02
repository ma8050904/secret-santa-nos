import { PARTICIPANTS } from "../src/lib/constants";
import {
  generateSecretSantaDerangement,
  validateDerangement,
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

async function runTests() {
  console.log("\n========================================================");
  console.log("  🎄 SECRET SANTA – PIN AUTH & INTEGRITY VERIFICATION 🎄");
  console.log("========================================================\n");

  // TEST 1: Participant List & Exact Names
  console.log("--- 1. Participant List & Casing Integrity ---");
  assert(PARTICIPANTS.length === 18, "Exact participant count is 18");

  const expectedNames = [
    "Qais Alhadeed",
    "Mohammad Alshourati",
    "Mohammad Darras",
    "Hamza Darawi",
    "Zeina Darawi",
    "JOEL",
    "Yara Brj",
    "Leya Alkhateeb",
    "Nard",
    "Sanad",
    "G_karkar4",
    "Shammas",
    "Ghazal",
    "Jude",
    "Malak",
    "Sarah",
    "Wasan",
    "Michooo",
  ];

  const actualNames = PARTICIPANTS.map((p) => p.name);
  const allNamesMatch = expectedNames.every((name, idx) => actualNames[idx] === name);
  assert(allNamesMatch, "All 18 participant names match exact spelling and capitalization");

  // TEST 2: Preserved Existing Assignments
  console.log("\n--- 2. Preservation of Existing Draw & Storage ---");
  const state = await getEventState();
  assert(state.participants.length === 18, "Storage file contains all 18 participants");
  assert(state.status === "active", "Event draw remains in active status (not reset)");

  // Verify that all 18 participants have an encryptedRecipient blob
  const allHaveAssignments = state.participants.every(
    (p) => typeof p.encryptedRecipient === "string" && p.encryptedRecipient.length > 0
  );
  assert(allHaveAssignments, "All 18 participants have valid encrypted assignments");

  // TEST 3: Cryptographic PIN Hashing & Verification
  console.log("\n--- 3. Cryptographic PIN Hashing & Salt Security ---");
  const testPin = "7492";
  const salt1 = generateRandomSalt();
  const salt2 = generateRandomSalt();

  const hash1 = hashPin(testPin, salt1);
  const hash2 = hashPin(testPin, salt2);

  assert(hash1 !== hash2, "Unique salts generate completely distinct hashes for same PIN");
  assert(verifyPin(testPin, hash1, salt1) === true, "Valid PIN verifies successfully");
  assert(verifyPin("0000", hash1, salt1) === false, "Incorrect PIN is rejected");

  // TEST 4: First-Time PIN Establishment Experience
  console.log("\n--- 4. First-Time PIN Setup Flow ---");
  // Test with participant Qais Alhadeed (p1)
  const p1 = state.participants.find((p) => p.id === "p1")!;

  // Mismatched confirm PIN rejected
  const mismatchResult = await authenticateOrRegisterPin("p1", "1234", "9999");
  assert(!mismatchResult.success, "First-time setup with mismatched confirm PIN is rejected");

  // Missing confirm PIN rejected on first visit
  const missingConfirmResult = await authenticateOrRegisterPin("p1", "1234", "");
  assert(!missingConfirmResult.success, "First-time setup without confirmation is rejected");

  // Clean first-time registration with matching PIN
  const validRegisterResult = await authenticateOrRegisterPin("p1", "4826", "4826");
  assert(validRegisterResult.success === true, "Participant can successfully establish their personal PIN");
  assert(validRegisterResult.isNewRegistration === true, "Action flagged as new registration");

  // TEST 5: Subsequent Login with Same PIN
  console.log("\n--- 5. Subsequent Login with Established PIN ---");
  // Logging in again with the registered PIN
  const loginSuccess = await authenticateOrRegisterPin("p1", "4826");
  assert(loginSuccess.success === true, "Subsequent login with correct PIN succeeds");
  assert(loginSuccess.isNewRegistration === false, "Action recognized as returning login");

  // Logging in with WRONG PIN
  const wrongPinLogin = await authenticateOrRegisterPin("p1", "9999");
  assert(!wrongPinLogin.success, "Login with wrong PIN is rejected");
  assert(
    Boolean(wrongPinLogin.error?.includes("Authentication failed")),
    "Generic error message does not leak registration status"
  );

  // TEST 6: Gift Reveal with PIN
  console.log("\n--- 6. Reveal Experience & Idempotency ---");
  // Reveal gift for Qais with wrong PIN
  const badReveal = await revealRecipientWithPin("p1", "0000");
  assert(!badReveal.success, "Reveal attempt with incorrect PIN strictly blocked");

  // Reveal gift for Qais with correct PIN
  const goodReveal = await revealRecipientWithPin("p1", "4826");
  assert(goodReveal.success === true, "Authorized participant reveals secret recipient");
  assert(typeof goodReveal.recipientName === "string" && goodReveal.recipientName.length > 0, `Recipient revealed: ${goodReveal.recipientName}`);
  assert(Boolean(goodReveal.recipientName && goodReveal.recipientName !== p1.name), "Recipient is not the participant themselves");

  // Revisit test
  const revisitReveal = await revealRecipientWithPin("p1", "4826");
  assert(revisitReveal.success === true, "Participant can revisit their secret result");
  assert(revisitReveal.recipientName === goodReveal.recipientName, "Revisit returns identical recipient (no re-shuffle)");
  assert(revisitReveal.isFirstReveal === false, "Revisit correctly marked as subsequent visit");

  // TEST 7: Cross-Participant Isolation
  console.log("\n--- 7. Cross-Participant Isolation ---");
  // Attempting to use Qais's PIN (4826) to reveal for Participant 2 (Mohammad Alshourati)
  const crossReveal = await revealRecipientWithPin("p2", "4826");
  assert(!crossReveal.success, "Participant 1 PIN cannot unlock Participant 2's gift");

  // TEST 8: Session Security
  console.log("\n--- 8. Session Token Verification ---");
  const secretKey = "SantaSessionSecret2024Key!_SafeHolidayToken";
  const token = createSessionToken("p1", secretKey);
  const session = verifySessionToken(token, secretKey);
  assert(session !== null && session.participantId === "p1", "Valid session token verifies participant ID");

  const tamperedToken = token + "tamper";
  const tamperedSession = verifySessionToken(tamperedToken, secretKey);
  assert(tamperedSession === null, "Tampered session token is rejected");

  // TEST 9: Organizer-Blind Privacy Audit
  console.log("\n--- 9. Organizer-Blind Privacy Audit ---");
  const adminState = await getAdminSafeState();
  assert(adminState.totalParticipants === 18, "Organizer dashboard sees 18 participants");

  const leakedKeys = (adminState.participants as any[]).some(
    (p) => p.pin || p.pinHash || p.pinSalt || p.code || p.encryptedRecipient || p.recipientName
  );
  assert(!leakedKeys, "CRITICAL SECURITY GATE: Admin state strictly omits PINs, hashes, and recipient mappings");

  // FINAL SUMMARY
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
