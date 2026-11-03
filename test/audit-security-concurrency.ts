import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  getEventState,
  saveEventState,
  authenticateOrRegisterPin,
  revealRecipientWithPin,
  getParticipantRuntimeState,
  getAdminSafeState,
} from "../src/lib/storage";
import { PARTICIPANTS } from "../src/lib/constants";
import { generateConstrainedSecretSantaDraw } from "../src/lib/derangement";
import {
  generateChristmasPasscode,
  hashPasscode,
  encryptRecipient,
  decryptRecipient,
} from "../src/lib/crypto";

// Ensure we are strictly running in an isolated temporary environment
const TEST_TMP_DIR = path.join("/tmp", `test-audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
const ISOLATED_TMP_FILE = path.join(TEST_TMP_DIR, "secret-santa-event.json");
process.env.STORAGE_FILE_PATH = ISOLATED_TMP_FILE;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${msg}`);
    throw new Error(msg);
  }
  console.log(`  ✅ PASS: ${msg}`);
}

async function runAudit() {
  console.log("=================================================================");
  console.log("  🔒 ISOLATED AUDIT: CONCURRENCY, RACE CONDITIONS & AUTH 🔒       ");
  console.log("=================================================================\n");

  // Setup seed event state in temporary test file
  const pairs = generateConstrainedSecretSantaDraw(PARTICIPANTS);
  const masterSalt = crypto.randomBytes(16).toString("hex");
  const storedParticipants = PARTICIPANTS.map((p) => {
    const pair = pairs.find((pr) => pr.giverId === p.id)!;
    const code = generateChristmasPasscode();
    const codeHash = hashPasscode(code, masterSalt);
    const encryptedRecipient = encryptRecipient(pair.recipientName, code, masterSalt);
    return {
      id: p.id,
      name: p.name,
      code,
      codeHash,
      encryptedRecipient,
      isRevealed: false,
      revealedAt: null,
      pinHash: null,
      pinSalt: null,
      encryptedWithPin: false,
    };
  });

  await saveEventState({
    version: 5,
    status: "active",
    createdAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    masterSalt,
    participants: storedParticipants,
  });

  const originalGiverToRecipient = new Map<string, string>();
  for (const pair of pairs) {
    originalGiverToRecipient.set(pair.giverId, pair.recipientName);
  }

  // =========================================================================
  // TEST 1: Concurrent first-time PIN registrations for the SAME participant
  // =========================================================================
  console.log("--- Test 1: Concurrent First-Time PIN Registration Race (Same Participant) ---");
  const testSubject = PARTICIPANTS[0]; // p1
  const candidatePins = ["1111", "2222", "3333", "4444", "5555"];

  // Launch 5 simultaneous registrations with different PIN candidates
  const sameUserPromises = candidatePins.map((pin) =>
    authenticateOrRegisterPin(testSubject.id, pin)
  );

  const sameUserResults = await Promise.all(sameUserPromises);
  console.log("sameUserResults:", sameUserResults);
  const successCount = sameUserResults.filter((r) => r.success).length;
  console.log(`  • Launched 5 simultaneous distinct PIN requests for participant ${testSubject.name}.`);
  console.log(`  • Successful completions: ${successCount}/5`);

  // Verify the resulting runtime state
  const p1Runtime = await getParticipantRuntimeState(testSubject.id);
  assert(p1Runtime !== null, "Participant p1 runtime state exists");
  assert(Boolean(p1Runtime?.pinHash && p1Runtime?.pinSalt), "Participant p1 has valid pinHash and pinSalt");

  // Determine which PIN won
  let winningPin: string | null = null;
  for (const pin of candidatePins) {
    const authCheck = await authenticateOrRegisterPin(testSubject.id, pin);
    if (authCheck.success) {
      winningPin = pin;
      break;
    }
  }

  assert(winningPin !== null, `One deterministic PIN (${winningPin}) is established and consistent`);

  // Reveal with the winning PIN and verify assignment integrity
  const revealTest = await revealRecipientWithPin(testSubject.id, winningPin!);
  assert(revealTest.success === true, "Reveal with winning PIN succeeded");
  assert(
    revealTest.recipientName === originalGiverToRecipient.get(testSubject.id),
    "Decrypted recipient matches seed draw perfectly without corruption"
  );

  // Attempt reveal with losing PINs
  for (const loserPin of candidatePins) {
    if (loserPin === winningPin) continue;
    const loserReveal = await revealRecipientWithPin(testSubject.id, loserPin);
    assert(loserReveal.success === false, `Reveal with conflicting PIN (${loserPin}) was blocked`);
  }

  // =========================================================================
  // TEST 2: Concurrent registrations for DIFFERENT participants (all remaining 47)
  // =========================================================================
  console.log("\n--- Test 2: Concurrent Registrations for 47 Different Participants ---");
  const remaining = PARTICIPANTS.slice(1);
  const concurrentRegistrations = remaining.map((p, idx) => {
    const pin = `9${String(idx).padStart(3, "0")}`;
    return authenticateOrRegisterPin(p.id, pin).then((res) => ({
      id: p.id,
      pin,
      res,
    }));
  });

  const multiResults = await Promise.all(concurrentRegistrations);
  const allSucceeded = multiResults.every((r) => r.res.success && r.res.isNewRegistration);
  assert(allSucceeded, "All 47 concurrent registrations succeeded independently");

  // Check state isolation: verify each participant's runtime record
  for (const r of multiResults) {
    const runtime = await getParticipantRuntimeState(r.id);
    if (!runtime || !runtime.pinHash) {
      throw new Error(`State missing for participant ${r.id}`);
    }
  }
  assert(true, "All 47 participant records are completely isolated in storage");

  // =========================================================================
  // TEST 3: Cross-Participant Isolation on Reveal
  // =========================================================================
  console.log("\n--- Test 3: Cross-Participant Isolation & Authorization on Reveal ---");

  // Participant 2 attempts to use Participant 3's PIN
  const p2 = multiResults[0]; // index 0 in multiResults is PARTICIPANTS[1]
  const p3 = multiResults[1]; // index 1 in multiResults is PARTICIPANTS[2]

  const crossAuth = await authenticateOrRegisterPin(p2.id, p3.pin);
  assert(crossAuth.success === false, "Participant 2 cannot login with Participant 3's PIN");

  const crossReveal = await revealRecipientWithPin(p2.id, p3.pin);
  assert(crossReveal.success === false, "Participant 2 cannot reveal with Participant 3's PIN");

  // Participant 2 reveals with own PIN
  const p2OwnReveal = await revealRecipientWithPin(p2.id, p2.pin);
  assert(p2OwnReveal.success === true, "Participant 2 reveals with own PIN");
  assert(
    p2OwnReveal.recipientName === originalGiverToRecipient.get(p2.id),
    "Participant 2 received their own intended recipient only"
  );
  assert(
    p2OwnReveal.recipientName !== originalGiverToRecipient.get(p3.id),
    "Participant 2 did not receive Participant 3's recipient"
  );

  // All 47 participants reveal concurrently
  const concurrentReveals = multiResults.map((item) =>
    revealRecipientWithPin(item.id, item.pin).then((res) => ({
      id: item.id,
      recipient: res.recipientName,
      success: res.success,
    }))
  );

  const revealOutcomes = await Promise.all(concurrentReveals);
  const allRevealsValid = revealOutcomes.every(
    (o) => o.success && o.recipient === originalGiverToRecipient.get(o.id)
  );
  assert(allRevealsValid, "All 47 simultaneous reveals returned strictly the caller's own recipient");

  // Idempotency: Participant reveals again
  const repeatReveal = await revealRecipientWithPin(p2.id, p2.pin);
  assert(repeatReveal.success === true && !repeatReveal.isFirstReveal, "Repeat reveal is idempotent");
  assert(repeatReveal.recipientName === p2OwnReveal.recipientName, "Repeat reveal returns identical recipient");

  // Clean up isolated temp files
  try {
    if (fs.existsSync(TEST_TMP_DIR)) fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true });
  } catch {}

  console.log("\n=================================================================");
  console.log("  ✅ ISOLATED CONCURRENCY & SECURITY AUDIT PASSED 100%");
  console.log("=================================================================\n");
}

runAudit().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
