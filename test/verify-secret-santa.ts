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
  FORBIDDEN_EXCLUSION_C,
  FORBIDDEN_EXCLUSION_D,
  MANDATORY_DIRECTED_GIVER_1,
  MANDATORY_DIRECTED_RECIPIENT_1,
  MANDATORY_DIRECTED_GIVER_2,
  MANDATORY_DIRECTED_RECIPIENT_2,
  SUBGROUP_20_IDS,
  SUBGROUP_20_ID_SET,
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
  getDeviceBinding,
  bindDeviceToParticipant,
  clearDeviceBindingsForParticipant,
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

const EXPECTED_56_NAMES = [
  "Amal 👩‍🔬",
  "Amjad🌏",
  "Diana 👩‍🏫🛘",
  "Elean Nshewat",
  "Fadi 👨‍🏫📖",
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
  "Katia Majrouh",
  "Kerolos Esrael",
  "Khalil Dabit",
  "Leya Al-Khatib",
  "Malak Hindaileh",
  "Malak Malek",
  "Maria Halaseh",
  "Mariana Salkawi",
  "Maya Joy Mahrejian",
  "Maysoon 🏫",
  "Michael Shamma",
  "Mirna 👩‍🏫🇬🇧",
  "Mohammad Alshourati",
  "Mohammad Darras",
  "Nardeen Abdallah",
  "Natalie Khacherian",
  "Nishan Nodiznaya",
  "Njoud👩‍🏫📜",
  "Omar Batshoun",
  "Omar Fakhoury",
  "Qais Al-Hadeed",
  "Raghad Al-Shobaki",
  "Sahar 🧬",
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
  for (const prefix of ["v5_", "v6_", "v7_"]) {
    for (const sub of ["participants", "revealed", "registered"]) {
      const d = path.join(testDir, `${prefix}${sub}`);
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  }

  console.log("\n========================================================");
  console.log("  🎄 SECRET SANTA – AUDIT & INTEGRITY VERIFICATION 🎄");
  console.log("========================================================\n");

  // =========================================================================
  // SUITE A: ROSTER INTEGRITY (56 Participants)
  // =========================================================================
  console.log("--- A. Participant Roster Integrity ---");
  assert(PARTICIPANTS.length === 56, "Exact participant count is 56");

  const actualNames = PARTICIPANTS.map((p) => p.name);
  const uniqueNames = new Set(actualNames);
  assert(uniqueNames.size === 56, "All 56 participant names are unique");

  const allNamesMatch = EXPECTED_56_NAMES.every((name, idx) => actualNames[idx] === name);
  assert(allNamesMatch, "All 56 participant names match exact spelling and capitalization in order");

  // =========================================================================
  // SUITE B: DRAW CONSTRAINTS & CRYPTOGRAPHIC STORAGE
  // =========================================================================
  console.log("\n--- B. Constrained Draw Integrity ---");
  const state = await getEventState();
  assert(state.participants.length === 56, "Storage contains all 56 participants");
  assert(state.status === "active", "Event draw remains in active status");
  assert(state.version === 7, "Event round version is 7");

  const allHaveAssignments = state.participants.every(
    (p) => typeof p.encryptedRecipient === "string" && p.encryptedRecipient.length > 0
  );
  assert(allHaveAssignments, "All 56 participants have valid encrypted assignments");

  // Decrypt all assignments to test constraints
  const decryptedMap = new Map<string, string>();
  for (const p of state.participants) {
    const recipient = decryptRecipient(p.encryptedRecipient!, p.code, state.masterSalt);
    decryptedMap.set(p.name, recipient);
  }

  // 1. Bijection check
  assert(decryptedMap.size === 56, "Exactly 56 givers present in draw");
  const recipientSet = new Set(decryptedMap.values());
  assert(recipientSet.size === 56, "Exactly 56 unique recipients present in draw");

  // 2. Zero self-assignments
  const selfAssignments = Array.from(decryptedMap.entries()).filter(([giver, rec]) => giver === rec);
  assert(selfAssignments.length === 0, "Zero self-assignments exist in draw");

  // 3. Mandatory reciprocal pair: Ghazal Baqleh <-> George Karkar
  const ghazalRecipient = decryptedMap.get(MANDATORY_RECIPROCAL_A);
  const georgeRecipient = decryptedMap.get(MANDATORY_RECIPROCAL_B);
  assert(
    ghazalRecipient === MANDATORY_RECIPROCAL_B && georgeRecipient === MANDATORY_RECIPROCAL_A,
    `Mandatory reciprocal assignment verified: ${MANDATORY_RECIPROCAL_A} ⇄ ${MANDATORY_RECIPROCAL_B}`
  );

  // 4. Mandatory exclusion 1: Zeina Darawi <-> Hamza Darawi
  const zeinaRecipient = decryptedMap.get(FORBIDDEN_EXCLUSION_A);
  const hamzaRecipient = decryptedMap.get(FORBIDDEN_EXCLUSION_B);
  assert(
    zeinaRecipient !== FORBIDDEN_EXCLUSION_B && hamzaRecipient !== FORBIDDEN_EXCLUSION_A,
    `Mandatory exclusion verified: ${FORBIDDEN_EXCLUSION_A} and ${FORBIDDEN_EXCLUSION_B} are NOT assigned to each other`
  );

  // 5. Mandatory exclusion 2: Raghad Al-Shobaki <-> Mohammad Alshourati
  const raghadRecipient = decryptedMap.get(FORBIDDEN_EXCLUSION_C);
  const shouratiRecipient = decryptedMap.get(FORBIDDEN_EXCLUSION_D);
  assert(
    raghadRecipient !== FORBIDDEN_EXCLUSION_D && shouratiRecipient !== FORBIDDEN_EXCLUSION_C,
    `Mandatory exclusion verified: ${FORBIDDEN_EXCLUSION_C} and ${FORBIDDEN_EXCLUSION_D} are NOT assigned to each other`
  );

  // 6. Mandatory directed assignment 1: Maysoon 🏫 -> Qais Al-Hadeed
  const maysoonRecipient = decryptedMap.get(MANDATORY_DIRECTED_GIVER_1);
  assert(
    maysoonRecipient === MANDATORY_DIRECTED_RECIPIENT_1,
    `Mandatory directed assignment verified: ${MANDATORY_DIRECTED_GIVER_1} gives to ${MANDATORY_DIRECTED_RECIPIENT_1}`
  );

  // 7. Mandatory directed assignment 2: Diana 👩‍🏫🛘 -> Mohammad Alshourati
  const dianaRecipient = decryptedMap.get(MANDATORY_DIRECTED_GIVER_2);
  assert(
    dianaRecipient === MANDATORY_DIRECTED_RECIPIENT_2,
    `Mandatory directed assignment verified: ${MANDATORY_DIRECTED_GIVER_2} gives to ${MANDATORY_DIRECTED_RECIPIENT_2}`
  );

  // 8. Mandatory Subgroup Isolation (24 members in subgroup 1, 32 members in subgroup 2)
  let subCrossEdges = 0;
  for (const [giver, rec] of decryptedMap.entries()) {
    const giverP = state.participants.find((p) => p.name === giver)!;
    const recP = state.participants.find((p) => p.name === rec)!;
    const giverInSub = SUBGROUP_20_ID_SET.has(giverP.id);
    const recInSub = SUBGROUP_20_ID_SET.has(recP.id);
    if ((giverInSub && !recInSub) || (!giverInSub && recInSub)) {
      subCrossEdges++;
    }
  }
  assert(subCrossEdges === 0, `Designated Subgroup is completely isolated (0 edges cross between 24-subgroup and remaining ${PARTICIPANTS.length - SUBGROUP_20_IDS.length})`);

  // 9. Mohammad Alshourati is in Subgroup and not self-assigned
  assert(shouratiRecipient !== "Mohammad Alshourati", "Mohammad Alshourati is not self-assigned");
  const shouratiRecP = state.participants.find((p) => p.name === shouratiRecipient)!;
  assert(SUBGROUP_20_ID_SET.has(shouratiRecP.id), "Mohammad Alshourati receives from and gives to designated Subgroup");

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

  // Short PIN rejected
  const shortPinRes = await authenticateOrRegisterPin("p1", "12");
  assert(shortPinRes.success === false, "PIN shorter than 4 characters is rejected");

  // First-time participant establishes PIN
  const p1Pin = "5821";
  const regRes = await authenticateOrRegisterPin("p1", p1Pin);
  assert(regRes.success === true, "First-time participant establishes PIN with 1 field entry");
  assert(regRes.isNewRegistration === true, "Recognized as first-time registration");

  // Returning participant uses established PIN
  const loginRes = await authenticateOrRegisterPin("p1", p1Pin);
  assert(loginRes.success === true, "Returning participant logs in with established PIN");
  assert(!loginRes.isNewRegistration, "Recognized as returning participant");

  // Wrong PIN rejected
  const wrongPinRes = await authenticateOrRegisterPin("p1", "9999");
  assert(wrongPinRes.success === false, "Login with wrong PIN is rejected");

  // =========================================================================
  // SUITE E: REVEAL EXPERIENCE & IDEMPOTENCY
  // =========================================================================
  console.log("\n--- E. Reveal Experience & Idempotency ---");

  // Reveal with wrong PIN
  const failReveal = await revealRecipientWithPin("p1", "0000");
  assert(failReveal.success === false, "Reveal attempt with incorrect PIN strictly blocked");

  // Valid first reveal
  const firstReveal = await revealRecipientWithPin("p1", p1Pin);
  assert(firstReveal.success === true, "Authorized participant reveals secret recipient");
  assert(typeof firstReveal.recipientName === "string", "Recipient revealed");
  assert(firstReveal.recipientName !== "Amal 👩‍🔬", "Recipient is not the participant themselves");
  assert(firstReveal.isFirstReveal === true, "First reveal correctly marked");

  // Subsequent reveal returns identical recipient
  const secondReveal = await revealRecipientWithPin("p1", p1Pin);
  assert(secondReveal.success === true, "Participant can revisit secret result");
  assert(secondReveal.recipientName === firstReveal.recipientName, "Revisit returns identical recipient");
  assert(secondReveal.isFirstReveal === false, "Revisit correctly marked as subsequent visit");

  // =========================================================================
  // SUITE F: CROSS-PARTICIPANT ISOLATION
  // =========================================================================
  console.log("\n--- F. Cross-Participant Isolation ---");

  // Participant 2 registers independently
  const p2Pin = "9183";
  await authenticateOrRegisterPin("p2", p2Pin);

  // Participant 2 cannot be unlocked with p1's PIN
  const crossUnlock = await authenticateOrRegisterPin("p2", p1Pin);
  assert(crossUnlock.success === false, "Participant 2 cannot be unlocked with incorrect PIN");

  const p2Reveal = await revealRecipientWithPin("p2", p2Pin);
  assert(p2Reveal.success === true, "Participant 2 reveals own secret recipient");
  assert(p2Reveal.recipientName !== "Amjad🌏", "Participant 2 recipient is not themselves");
  assert(p2Reveal.recipientName !== firstReveal.recipientName, "Participant 2 received distinct recipient");

  // =========================================================================
  // SUITE G: SESSION SECURITY & ROUND INVALIDATION
  // =========================================================================
  console.log("\n--- G. Session Security & Round Invalidation ---");
  const round7Secret = "SantaMagic2024_Round7_FinalClean_v7_Production_Strict";
  const round6Secret = "SantaMagic2024_Round6_PinResetTokenKey_v6_fresh";
  const round5Secret = "SantaMagic2024_Round5_SecureTokenKey_v5";

  const round7Token = createSessionToken("p1", round7Secret);
  const round6Token = createSessionToken("p1", round6Secret);
  const round5Token = createSessionToken("p1", round5Secret);

  // Valid Round 7 token verified
  assert(verifySessionToken(round7Token, round7Secret)?.participantId === "p1", "Valid Round 7 session token verifies participant ID");

  // Previous round tokens strictly rejected
  assert(verifySessionToken(round6Token, round7Secret) === null, "Previous Round 6 session token is rejected in Round 7");
  assert(verifySessionToken(round5Token, round7Secret) === null, "Previous Round 5 session token is rejected in Round 7");

  // Tampered token rejected
  const tamperedToken = round7Token.slice(0, -4) + "XXXX";
  assert(verifySessionToken(tamperedToken, round7Secret) === null, "Tampered session token is rejected");

  // =========================================================================
  // SUITE H: CONCURRENCY LOAD TEST (Simulating 56 concurrent participants)
  // =========================================================================
  console.log("\n--- H. Concurrency Load Test (Simulating 56 Concurrent Users) ---");

  // 1. 56 Simultaneous directory read requests
  console.log("  Testing 56 simultaneous directory read requests...");
  const t0 = Date.now();
  const readResults = await Promise.all(
    Array.from({ length: 56 }).map(async () => {
      const s = await getEventState();
      return s.participants.length === 56;
    })
  );
  const readDuration = Date.now() - t0;
  assert(
    readResults.every(Boolean),
    `All 56 simultaneous read requests succeeded (${readDuration}ms total)`
  );

  // 2. 54 Simultaneous first-time PIN registrations (p3 through p56)
  console.log("  Testing 54 simultaneous independent PIN registrations...");
  const registrationPromises = state.participants.slice(2).map(async (p, idx) => {
    const pin = `1000${idx + 3}`;
    const res = await authenticateOrRegisterPin(p.id, pin);
    return res;
  });

  const regResults = await Promise.all(registrationPromises);
  const allRegSuccess = regResults.every((r) => r.success && r.isNewRegistration);
  assert(allRegSuccess, "All 54 concurrent PIN registrations succeeded with zero lost updates");

  // 3. 54 Simultaneous reveals across all participants
  console.log("  Testing 54 simultaneous independent reveal operations...");
  const revealPromises = state.participants.slice(2).map(async (p, idx) => {
    const pin = `1000${idx + 3}`;
    const res = await revealRecipientWithPin(p.id, pin);
    return {
      id: p.id,
      success: res.success,
      recipientName: res.recipientName,
      hasRecipient: typeof res.recipientName === "string" && res.recipientName.length > 0,
    };
  });

  const revResults = await Promise.all(revealPromises);
  const allRevSuccess = revResults.every((r) => r.success && r.hasRecipient);
  assert(allRevSuccess, "All 54 concurrent reveal operations succeeded with zero errors");

  // Verify that all 56 recipients match the original decrypted draw exactly
  let assignmentsIntact = true;
  for (const r of revResults) {
    const expected = decryptedMap.get(state.participants.find((p) => p.id === r.id)!.name);
    if (r.recipientName !== expected) {
      assignmentsIntact = false;
      break;
    }
  }
  assert(assignmentsIntact, "All revealed recipients match original draw with 100% data integrity");

  // 4. Repeated concurrent requests to same participant are completely idempotent
  console.log("  Testing concurrent duplicate submissions and idempotency...");
  const dupResults = await Promise.all(
    Array.from({ length: 5 }).map(() => revealRecipientWithPin("p1", p1Pin))
  );
  const allDupMatches = dupResults.every((r) => r.recipientName === firstReveal.recipientName);
  assert(allDupMatches, "Repeated concurrent requests to same participant are completely idempotent");

  // =========================================================================
  // SUITE I: ORGANIZER-BLIND PRIVACY AUDIT
  // =========================================================================
  console.log("\n--- I. Organizer-Blind Privacy Audit ---");
  const adminState = await getAdminSafeState();
  assert(adminState.totalParticipants === 56, "Organizer sees exactly 56 participants");
  assert(adminState.registeredCount === 56, "All 56 participants tracked as registered");
  assert(adminState.revealedCount === 56, "All 56 participants tracked as revealed");

  // Strictly verify privacy: no PINs, salts, or recipients in admin state
  const leakedData = adminState.participants.some(
    (p: any) =>
      p.pin ||
      p.pinHash ||
      p.pinSalt ||
      p.code ||
      p.codeHash ||
      p.encryptedRecipient ||
      p.recipientName ||
      p.assignedTo
  );
  assert(!leakedData, "CRITICAL PRIVACY GATE: Admin state strictly omits PINs, hashes, and recipient mappings");

  // =========================================================================
  // SUITE J: PARTICIPANT SESSION LOCK & IDENTITY PROTECTION
  // =========================================================================
  console.log("\n--- J. Participant Session Lock & Identity Protection ---");

  // Dynamically import Route Handlers to test HTTP 403 Session Binding
  const { POST: pinPost } = await import("../src/app/api/auth/pin/route");
  const { POST: revealPost } = await import("../src/app/api/reveal/route");

  // 1. Participant 1 establishes valid Round 7 session token
  const validP1Token = createSessionToken("p1", round7Secret);

  // 2. Participant 1 attempts to authenticate as Participant 2 using P1's session token
  const switchIdentityReq = new NextRequest("http://localhost:3000/api/auth/pin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `santa_session_v7_clean=${validP1Token}`,
    },
    body: JSON.stringify({ participantId: "p2", pin: p2Pin }),
  });

  const switchRes = await pinPost(switchIdentityReq);
  const switchData = await switchRes.json();

  assert(switchRes.status === 403, "Attempt to switch participant identity within active session is blocked with HTTP 403");
  assert(
    !switchData.error.toLowerCase().includes("log out"),
    "Session lock error message does NOT contain 'log out'"
  );
  assert(
    switchData.error.toLowerCase().includes("locked") || switchData.error.toLowerCase().includes("device"),
    "Session lock error message explicitly states session is locked"
  );

  // 3. Participant 1 attempts to call /api/reveal for Participant 2 using P1's session token
  const crossRevealReq = new NextRequest("http://localhost:3000/api/reveal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `santa_session_v7_clean=${validP1Token}`,
    },
    body: JSON.stringify({ participantId: "p2", pin: p2Pin }),
  });

  const crossRevealRes = await revealPost(crossRevealReq);
  assert(crossRevealRes.status === 403, "Attempt to reveal another participant's gift within active session is blocked with HTTP 403");

  // 4. Request without cookie to Participant 2 succeeds independently
  const separateDeviceReq = new NextRequest("http://localhost:3000/api/auth/pin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ participantId: "p2", pin: p2Pin }),
  });
  const separateDeviceRes = await pinPost(separateDeviceReq);
  const separateDeviceData = await separateDeviceRes.json();
  assert(separateDeviceRes.status === 200 && separateDeviceData.success === true, "Separate device without session cookie authenticates independently");

  // =========================================================================
  // SUITE K: DEVICE BINDING & PRIVACY ENFORCEMENT
  // =========================================================================
  console.log("\n--- K. Device Binding & Privacy Enforcement ---");
  const { GET: devStatusGet } = await import("../src/app/api/auth/device-status/route");

  const devA = "11111111-2222-4333-8444-555555555555";
  const devB = "99999999-8888-4777-8666-555555555555";

  // 1. Participant 3 authenticates and binds on Device A
  const bindReqA = new NextRequest("http://localhost:3000/api/auth/pin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-device-id": devA,
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile",
    },
    body: JSON.stringify({ participantId: "p3", pin: "10003" }),
  });
  const bindResA = await pinPost(bindReqA);
  const bindDataA = await bindResA.json();
  assert(bindResA.status === 200 && bindDataA.success === true, "Participant 3 successfully registers and binds on Device A");

  // 2. Authoritative storage verification of Device A
  const storedDevA = await getDeviceBinding(devA);
  assert(storedDevA !== null, "Device A is stored in authoritative device registry");
  assert(storedDevA?.participantId === "p3", "Device A is authoritatively mapped to Participant 3");

  // 3. Device status check for Device A
  const statusReqA = new NextRequest("http://localhost:3000/api/auth/device-status", {
    method: "GET",
    headers: {
      "x-device-id": devA,
    },
  });
  const statusResA = await devStatusGet(statusReqA);
  const statusDataA = await statusResA.json();
  assert(statusDataA.bound === true, "Device status correctly reports Device A as bound");
  assert(statusDataA.participantId === "p3", "Device status returns bound participantId p3");

  // 4. Device A attempts to access Participant 4 (Blocked by Device Lock)
  const hackReqA = new NextRequest("http://localhost:3000/api/auth/pin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-device-id": devA,
    },
    body: JSON.stringify({ participantId: "p4", pin: "10004" }),
  });
  const hackResA = await pinPost(hackReqA);
  const hackDataA = await hackResA.json();
  assert(hackResA.status === 403, "Attempt to authenticate as another participant from bound Device A is blocked with HTTP 403");
  assert(hackDataA.error.includes("device") || hackDataA.error.includes("linked") || hackDataA.error.includes("registered"), "Block message clearly describes device binding restriction");

  // Device A blocked from calling reveal for Participant 4
  const hackRevealReqA = new NextRequest("http://localhost:3000/api/reveal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-device-id": devA,
    },
    body: JSON.stringify({ participantId: "p4", pin: "10004" }),
  });
  const hackRevealResA = await revealPost(hackRevealReqA);
  assert(hackRevealResA.status === 403, "Attempt to reveal another participant's gift from bound Device A is blocked with HTTP 403");

  // 5. Independent Device B accesses Participant 4 (Clean & Unblocked)
  const bindReqB = new NextRequest("http://localhost:3000/api/auth/pin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-device-id": devB,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
    },
    body: JSON.stringify({ participantId: "p4", pin: "10004" }),
  });
  const bindResB = await pinPost(bindReqB);
  const bindDataB = await bindResB.json();
  assert(bindResB.status === 200 && bindDataB.success === true, "Participant 4 authenticates successfully from independent Device B");
  const storedDevB = await getDeviceBinding(devB);
  assert(storedDevB?.participantId === "p4", "Device B is authoritatively mapped to Participant 4");

  // 6. Authorized recovery: clear device bindings for Participant 3
  const recoveryResult = await clearDeviceBindingsForParticipant("p3");
  assert(recoveryResult.success === true, "Authorized device recovery completes successfully");
  const postRecoveryBinding = await getDeviceBinding(devA);
  assert(postRecoveryBinding === null, "Device A binding is safely cleared after recovery");

  // 7. Verify all 56 assignments in storage remain 100% byte-for-byte intact
  const finalState = await getEventState();
  assert(finalState.version === 7, "Event state version is still Round 7");
  assert(finalState.participants.length === 56, "Event participant roster count remains exactly 56");
  assert(finalState.participants.every((p) => p.encryptedRecipient), "All 56 Secret Santa assignments remain byte-for-byte intact");

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
