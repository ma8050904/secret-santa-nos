import { PARTICIPANTS } from "../src/lib/constants";
import {
  generateSecretSantaDerangement,
  validateDerangement,
} from "../src/lib/derangement";
import {
  encryptRecipient,
  decryptRecipient,
  generateChristmasPasscode,
  hashPasscode,
  secureCompare,
} from "../src/lib/crypto";
import {
  getEventState,
  revealRecipientForParticipant,
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
  console.log("  🎄 SECRET SANTA – COMPREHENSIVE VERIFICATION SUITE 🎄");
  console.log("========================================================\n");

  // TEST 1: Exactly 18 Participants
  console.log("--- 1. Participant Integrity Verification ---");
  assert(PARTICIPANTS.length === 18, "Exact participant count is 18", `Found ${PARTICIPANTS.length}`);

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
  assert(allNamesMatch, "All 18 participant names match exact spelling and casing");

  // TEST 2: Derangement & Mathematical Correctness (1,000 iterations simulation)
  console.log("\n--- 2. Derangement Engine (1,000 Iterations Simulation) ---");
  let derangementFailures = 0;
  for (let iter = 0; iter < 1000; iter++) {
    const pairs = generateSecretSantaDerangement(PARTICIPANTS);
    const check = validateDerangement(PARTICIPANTS, pairs);
    if (!check.valid) {
      derangementFailures++;
    }
  }
  assert(
    derangementFailures === 0,
    "1,000 / 1,000 Derangements passed strict mathematical verification",
    `Failures: ${derangementFailures}`
  );

  // Single run detail inspection
  const singlePairs = generateSecretSantaDerangement(PARTICIPANTS);
  const selfAssigned = singlePairs.filter((p) => p.giverId === p.recipientId);
  assert(selfAssigned.length === 0, "Zero self-assignments (nobody gives to themselves)");

  const recipientIds = new Set(singlePairs.map((p) => p.recipientId));
  assert(recipientIds.size === 18, "No duplicate recipients (perfect 1-to-1 bijection)");

  // TEST 3: Cryptographic Round-Trip (AES-256-GCM + PBKDF2)
  console.log("\n--- 3. Cryptographic Encryption & Decryption ---");
  const testSalt = "a1b2c3d4e5f6a1b2c3d4e5f6";
  const testPasscode = "SANTA-7K9M";
  const testRecipient = "Zeina Darawi";

  const ciphertext = encryptRecipient(testRecipient, testPasscode, testSalt);
  assert(typeof ciphertext === "string" && ciphertext.includes(":"), "Recipient encrypted to valid IV:Tag:Ciphertext format");

  const decrypted = decryptRecipient(ciphertext, testPasscode, testSalt);
  assert(decrypted === testRecipient, "Decrypted text perfectly matches original recipient");

  // Tamper resistance test
  let failedTamper = false;
  try {
    decryptRecipient(ciphertext, "WRONG-CODE", testSalt);
  } catch {
    failedTamper = true;
  }
  assert(failedTamper, "Decryption strictly fails with invalid access code");

  // TEST 4: Storage & Initialization
  console.log("\n--- 4. Persistent Storage & Event State ---");
  const state = await getEventState();
  assert(state.participants.length === 18, "Persistent store contains 18 participant records");
  assert(state.status === "active", "Event initialized to active status");

  // Verify that plaintext recipient names DO NOT exist in database records
  const anyPlaintextLeaked = (state.participants as any[]).some(
    (p) => p.recipientName || p.recipientId || p.giverId
  );
  assert(!anyPlaintextLeaked, "Zero plaintext recipient names exist in database records (Organizer-Blind)");

  // TEST 5: Authentication & Reveal Experience
  console.log("\n--- 5. Authentication & Reveal Authorization ---");
  const sampleParticipant = state.participants[0]; // e.g. Qais Alhadeed
  const validCode = sampleParticipant.code;

  // Invalid passcode attempt
  const invalidReveal = await revealRecipientForParticipant(sampleParticipant.id, "INCORRECT-CODE");
  assert(!invalidReveal.success, "Unauthorized reveal attempt rejected");

  // Valid passcode attempt
  const validReveal = await revealRecipientForParticipant(sampleParticipant.id, validCode);
  assert(validReveal.success === true, "Authorized participant reveals secret recipient");
  assert(typeof validReveal.recipientName === "string" && validReveal.recipientName.length > 0, `Recipient name received: ${validReveal.recipientName}`);
  assert(validReveal.recipientName !== sampleParticipant.name, "Recipient is not the participant themselves");

  // Revisit test (Idempotency)
  const revisitReveal = await revealRecipientForParticipant(sampleParticipant.id, validCode);
  assert(revisitReveal.success === true, "Participant can revisit their secret result");
  assert(revisitReveal.recipientName === validReveal.recipientName, "Revisiting preserves the exact same assignment (no re-shuffle)");
  assert(revisitReveal.isFirstReveal === false, "Revisit correctly marked as subsequent reveal");

  // Cross-participant impersonation test: using Participant 1's code for Participant 2
  const otherParticipant = state.participants[1];
  const impersonateAttempt = await revealRecipientForParticipant(otherParticipant.id, validCode);
  assert(!impersonateAttempt.success, "Cross-participant impersonation strictly blocked (Code 1 invalid for Participant 2)");

  // TEST 6: Organizer-Blind Privacy Verification
  console.log("\n--- 6. Organizer-Blind Privacy Audit ---");
  const adminView = await getAdminSafeState();

  assert(adminView.totalParticipants === 18, "Admin sees correct total count");
  assert(adminView.revealedCount >= 1, "Admin sees aggregate reveal count");

  // Strict schema inspection of adminView
  const leakedRecipientInAdmin = (adminView.participants as any[]).some(
    (p) => p.recipientName || p.recipientId || p.assignedTo || p.encryptedRecipient
  );
  assert(
    !leakedRecipientInAdmin,
    "CRITICAL SECURITY GATE: Admin API response contains ZERO recipient names, IDs, or encrypted blobs"
  );

  // TEST 7: Search Filtering Logic
  console.log("\n--- 7. Search Filter Verification ---");
  const searchTest1 = PARTICIPANTS.filter((p) => p.name.toLowerCase().includes("mohammad"));
  assert(searchTest1.length === 2, "Search for 'mohammad' finds 2 participants (Alshourati and Darras)");

  const searchTest2 = PARTICIPANTS.filter((p) => p.name.toLowerCase().includes("karkar"));
  assert(searchTest2.length === 1 && searchTest2[0].name === "G_karkar4", "Partial search 'karkar' finds G_karkar4");

  const searchTest3 = PARTICIPANTS.filter((p) => p.name.toLowerCase().includes("joel"));
  assert(searchTest3.length === 1 && searchTest3[0].name === "JOEL", "Case-insensitive search 'joel' finds uppercase JOEL");

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
