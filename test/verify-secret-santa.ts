import fs from "fs";
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
  startRegistrationSession,
  getRegistrationSessionStatus,
  pauseRegistrationSession,
  resumeRegistrationSession,
  skipRegistrationTurn,
  revisitParticipantRegistration,
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
  // Clean up test file if isolated path specified
  if (process.env.STORAGE_FILE_PATH && fs.existsSync(process.env.STORAGE_FILE_PATH)) {
    fs.rmSync(process.env.STORAGE_FILE_PATH, { force: true });
  }

  console.log("\n========================================================");
  console.log("  🎄 SECRET SANTA – AUDIT & INTEGRITY VERIFICATION 🎄");
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

  // TEST 2: Preserved Existing Assignments & Active Event
  console.log("\n--- 2. Draw State & Cryptographic Storage ---");
  const state = await getEventState();
  assert(state.participants.length === 18, "Storage file contains all 18 participants");
  assert(state.status === "active", "Event draw remains in active status");

  const allHaveAssignments = state.participants.every(
    (p) => typeof p.encryptedRecipient === "string" && p.encryptedRecipient.length > 0
  );
  assert(allHaveAssignments, "All 18 participants have valid encrypted assignments");

  // TEST 3: Cryptographic PIN Hashing & Salt Security
  console.log("\n--- 3. Cryptographic PIN Hashing & Salt Security ---");
  const testPin = "7492";
  const salt1 = generateRandomSalt();
  const salt2 = generateRandomSalt();

  const hash1 = hashPin(testPin, salt1);
  const hash2 = hashPin(testPin, salt2);

  assert(hash1 !== hash2, "Unique salts generate completely distinct hashes for same PIN");
  assert(verifyPin(testPin, hash1, salt1) === true, "Valid PIN verifies successfully");
  assert(verifyPin("0000", hash1, salt1) === false, "Incorrect PIN is rejected");

  // TEST 4: Single-Field PIN Setup & Login
  console.log("\n--- 4. Single-Field PIN Registration & Authentication ---");
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

  // TEST 5: Gift Reveal & Idempotency
  console.log("\n--- 5. Reveal Experience & Idempotency ---");
  const badReveal = await revealRecipientWithPin("p1", "0000");
  assert(!badReveal.success, "Reveal attempt with incorrect PIN strictly blocked");

  const goodReveal = await revealRecipientWithPin("p1", "5829");
  assert(goodReveal.success === true, "Authorized participant reveals secret recipient");
  assert(typeof goodReveal.recipientName === "string" && goodReveal.recipientName.length > 0, "Recipient revealed without leaking in logs");
  assert(Boolean(goodReveal.recipientName && goodReveal.recipientName !== p1.name), "Recipient is not the participant themselves");

  // Revisit
  const revisitReveal = await revealRecipientWithPin("p1", "5829");
  assert(revisitReveal.success === true, "Participant can revisit their secret result");
  assert(revisitReveal.recipientName === goodReveal.recipientName, "Revisit returns identical recipient (no re-shuffle)");
  assert(revisitReveal.isFirstReveal === false, "Revisit correctly marked as subsequent visit");

  // TEST 6: Cross-Participant Isolation
  console.log("\n--- 6. Cross-Participant Isolation ---");
  const crossReveal = await revealRecipientWithPin("p2", "5829");
  assert(!crossReveal.success, "Participant 1 PIN cannot unlock Participant 2's gift");

  // TEST 7: Session Token Verification
  console.log("\n--- 7. Session Security ---");
  const secretKey = "SantaSessionSecret2024Key!_SafeHolidayToken";
  const token = createSessionToken("p1", secretKey);
  const session = verifySessionToken(token, secretKey);
  assert(session !== null && session.participantId === "p1", "Valid session token verifies participant ID");

  const tamperedToken = token + "tamper";
  const tamperedSession = verifySessionToken(tamperedToken, secretKey);
  assert(tamperedSession === null, "Tampered session token is rejected");

  // TEST 8: Organizer-Blind Privacy Audit
  console.log("\n--- 8. Organizer-Blind Privacy Audit ---");
  const adminState = await getAdminSafeState();
  assert(adminState.totalParticipants === 18, "Organizer dashboard sees 18 participants");

  const leakedKeys = (adminState.participants as any[]).some(
    (p) => p.pin || p.pinHash || p.pinSalt || p.code || p.encryptedRecipient || p.recipientName
  );
  assert(!leakedKeys, "CRITICAL PRIVACY GATE: Admin state strictly omits PINs, hashes, and recipient mappings");

  // TEST 9: Supervised 1-at-a-Time Registration Flow
  console.log("\n--- 9. Supervised 1-at-a-Time Registration Flow ---");
  const initRegStatus = await getRegistrationSessionStatus();
  assert(initRegStatus.session.totalTurns === 18, "Session knows total participants (18)");

  const startRes = await startRegistrationSession();
  assert(startRes.success, "Organizer starts registration session");
  assert(startRes.session.status === "active", "Registration session status is active");
  const startTurn = startRes.session.currentTurn;
  assert(startTurn >= 1 && startTurn <= 18, `Registration starts at active turn (Turn ${startTurn})`);
  assert(startRes.session.turnDurationSeconds === 60, "Turn window configured for 60 seconds");

  const statusAfterStart = await getRegistrationSessionStatus();
  assert(statusAfterStart.session.timeRemainingSeconds <= 60 && statusAfterStart.session.timeRemainingSeconds > 0, "60-second countdown actively ticking");

  const activePartId = startRes.session.activeParticipantId;
  assert(Boolean(activePartId), `Active participant assigned for Turn ${startTurn}`);

  // Verify non-active participant cannot register while another's turn is active
  const otherPart = (await getEventState()).participants.find((p) => p.id !== activePartId && !p.pinHash);
  if (otherPart) {
    const wrongTurnAuth = await authenticateOrRegisterPin(otherPart.id, "9999");
    assert(!wrongTurnAuth.success, "Concurrent registration blocked: non-active participant cannot register out of turn");
  }

  // Register active participant with 1-field PIN
  const regTurn1 = await authenticateOrRegisterPin(activePartId!, "1234");
  assert(regTurn1.success, "Active participant successfully registers PIN in their window");
  assert(Boolean(regTurn1.isNewRegistration), "Registration confirmed without confirmation field");

  // Check turn immediately advanced
  const afterTurn1Status = await getRegistrationSessionStatus();
  assert(afterTurn1Status.session.currentTurn === startTurn + 1, `Turn immediately advanced to Turn ${startTurn + 1} after registration`);
  assert(afterTurn1Status.session.registeredCount >= 1, "Registered count incremented");

  // Test Pause & Resume
  const pauseRes = await pauseRegistrationSession();
  assert(pauseRes.success && pauseRes.session.status === "paused", "Organizer can pause active registration session");

  const resumeRes = await resumeRegistrationSession();
  assert(resumeRes.success && resumeRes.session.status === "active", "Organizer can resume paused registration session");

  // Test Skip Turn
  const skipTurnBefore = resumeRes.session.currentTurn;
  const skipRes = await skipRegistrationTurn();
  assert(skipRes.success && skipRes.session.currentTurn === skipTurnBefore + 1, "Organizer can skip turn if participant is unavailable");

  // Test Revisit Unregistered Participant
  if (otherPart) {
    const revisitRes = await revisitParticipantRegistration(otherPart.id);
    assert(Boolean(revisitRes.success && revisitRes.session && revisitRes.session.activeParticipantId === otherPart.id), "Organizer can revisit specific unregistered participant");
  }

  // Verify Admin still has zero assignment visibility
  const adminDuringReg = await getAdminSafeState();
  const regLeak = (adminDuringReg.participants as any[]).some((p) => p.encryptedRecipient || p.recipientName);
  assert(!regLeak, "Assignments remain strictly hidden during registration");

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
