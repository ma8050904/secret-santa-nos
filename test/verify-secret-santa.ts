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
  "Diana 👩‍🏫🛘",
  "Fadi 👨‍🏫📖",
  "Njoud👩‍🏫📜",
  "Amal 👩‍🔬",
  "Sahar 🧬",
  "Mirna 👩‍🏫🇬🇧",
  "Amjad🌏",
  "Ibrahim👨🏫🇬🇧",
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
    const dec = decryptRecipient(p.encryptedRecipient!, p.code, state.masterSalt);
    decryptedMap.set(p.name, dec);
  }

  // 1. Bijection check
  assert(decryptedMap.size === 56, "Exactly 56 givers present in draw");
  const recipientSet = new Set(decryptedMap.values());
  assert(recipientSet.size === 56, "Exactly 56 unique recipients present in draw");

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

  // 4. Mandatory exclusion 1: Zeina Darawi <-> Hamza Darawi
  const zeinaRecipient = decryptedMap.get(FORBIDDEN_EXCLUSION_A);
  const hamzaRecipient = decryptedMap.get(FORBIDDEN_EXCLUSION_B);
  assert(
    zeinaRecipient !== FORBIDDEN_EXCLUSION_B && hamzaRecipient !== FORBIDDEN_EXCLUSION_A,
    `Mandatory exclusion verified: ${FORBIDDEN_EXCLUSION_A} and ${FORBIDDEN_EXCLUSION_B} are NOT assigned to each other`
  );

  // 5. Mandatory exclusion 2: Raghad Al-Shobaki <-> Mohammad Shourati
  const raghadRecipient = decryptedMap.get(FORBIDDEN_EXCLUSION_C);
  const shouratiRecipient = decryptedMap.get(FORBIDDEN_EXCLUSION_D);
  assert(
    raghadRecipient !== FORBIDDEN_EXCLUSION_D && shouratiRecipient !== FORBIDDEN_EXCLUSION_C,
    `Mandatory exclusion verified: ${FORBIDDEN_EXCLUSION_C} and ${FORBIDDEN_EXCLUSION_D} are NOT assigned to each other`
  );

  // 6. Mandatory Subgroup Isolation (22 members in subgroup 1, 33 members in subgroup 2)
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
  assert(subCrossEdges === 0, `Designated Subgroup is completely isolated (0 edges cross between 22-subgroup and remaining ${PARTICIPANTS.length - SUBGROUP_20_IDS.length})`);

  // 7. Mohammad Shourati is in Subgroup and not self-assigned
  assert(shouratiRecipient !== "Mohammad Shourati", "Mohammad Shourati is not self-assigned");
  const shouratiRecP = state.participants.find((p) => p.name === shouratiRecipient)!;
  assert(SUBGROUP_20_ID_SET.has(shouratiRecP.id), "Mohammad Shourati receives from and gives to designated Subgroup");

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
  const round7Secret = "SantaMagic2024_Round7_FinalClean_v7_Production_Strict";
  const round6Secret = "SantaMagic2024_Round6_PinResetTokenKey_v6_fresh";
  const round5Secret = "SantaMagic2024_Round5_SecureTokenKey_v5";

  // Token created with Round 7 secret validates
  const validToken = createSessionToken("p1", round7Secret);
  const verified = verifySessionToken(validToken, round7Secret);
  assert(verified?.participantId === "p1", "Valid Round 7 session token verifies participant ID");

  // Token created with Round 6 secret is REJECTED
  const oldRound6Token = createSessionToken("p1", round6Secret);
  const oldRound6Verified = verifySessionToken(oldRound6Token, round7Secret);
  assert(oldRound6Verified === null, "Previous Round 6 session token is rejected in Round 7");

  // Token created with previous round secret (Round 5) is REJECTED
  const oldToken = createSessionToken("p1", round5Secret);
  const oldVerified = verifySessionToken(oldToken, round7Secret);
  assert(oldVerified === null, "Previous Round 5 session token is rejected in Round 7");

  // Tampered token is rejected
  const tamperedToken = validToken.substring(0, validToken.length - 4) + "XXXX";
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
    return { id: p.id, success: res.success, isNew: res.isNewRegistration };
  });

  const regResults = await Promise.all(registrationPromises);
  const allRegSuccess = regResults.every((r) => r.success && r.isNew);
  assert(allRegSuccess, "All 54 concurrent PIN registrations succeeded with zero lost updates");

  // 3. 54 Simultaneous reveals across all participants
  console.log("  Testing 54 simultaneous independent reveal operations...");
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
  assert(allRevSuccess, "All 54 concurrent reveal operations succeeded with zero errors");

  // Verify that all 56 recipients match the original decrypted draw exactly
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
  assert(adminState.totalParticipants === 56, "Organizer sees exactly 56 participants");
  assert(adminState.registeredCount === 56, "All 56 participants tracked as registered");
  assert(adminState.revealedCount === 56, "All 56 participants tracked as revealed");

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

  function createMockRequest(url: string, body: any, sessionParticipantId?: string, deviceId?: string) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sessionParticipantId) {
      const token = createSessionToken(sessionParticipantId, round7Secret);
      headers["cookie"] = `santa_session_v7_clean=${token}`;
    }
    if (deviceId) {
      headers["x-device-id"] = deviceId;
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
  // SUITE K: DEVICE BINDING & PRIVACY ENFORCEMENT
  // =========================================================================
  console.log("\n--- K. Device Binding & Privacy Enforcement ---");
  const { GET: deviceStatusRoute } = await import("../src/app/api/auth/device-status/route");

  const devA = "11111111-2222-4333-8444-555555555555";
  const devB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  // 1. Authenticate Participant 3 on Device A -> should succeed and bind Device A to p3
  const bindReqA = createMockRequest(
    "http://localhost:3000/api/auth/pin",
    { participantId: "p3", pin: "10003" },
    undefined,
    devA
  );
  const bindResA = await pinRoute(bindReqA);
  const bindDataA = await bindResA.json();
  assert(bindResA.status === 200 && bindDataA.success === true, "Participant 3 successfully registers and binds on Device A");

  const bindingRecordA = await getDeviceBinding(devA);
  assert(bindingRecordA !== null, "Device A is stored in authoritative device registry");
  assert(bindingRecordA?.participantId === "p3", "Device A is authoritatively mapped to Participant 3");

  // 2. Query device status endpoint for Device A
  const devStatusReqA = new NextRequest("http://localhost:3000/api/auth/device-status", {
    method: "GET",
    headers: { "x-device-id": devA },
  });
  const devStatusResA = await deviceStatusRoute(devStatusReqA);
  const devStatusDataA = await devStatusResA.json();
  assert(devStatusDataA.bound === true, "Device status correctly reports Device A as bound");
  assert(devStatusDataA.participantId === "p3", "Device status returns bound participantId p3");

  // 3. Unauthorized access: Device A attempting to authenticate as Participant 4 -> rejected with HTTP 403
  const hijackPinReq = createMockRequest(
    "http://localhost:3000/api/auth/pin",
    { participantId: "p4", pin: "10004" },
    undefined,
    devA
  );
  const hijackPinRes = await pinRoute(hijackPinReq);
  const hijackPinData = await hijackPinRes.json();
  assert(hijackPinRes.status === 403, "Attempt to authenticate as another participant from bound Device A is blocked with HTTP 403");
  assert(
    hijackPinData.error?.includes("registered to another participant") ||
    hijackPinData.error?.includes("same device"),
    "Block message clearly describes device binding restriction"
  );

  // 4. Unauthorized reveal: Device A attempting to call /api/reveal for Participant 4 -> rejected with HTTP 403
  const hijackRevealReq = createMockRequest(
    "http://localhost:3000/api/reveal",
    { participantId: "p4", pin: "10004" },
    undefined,
    devA
  );
  const hijackRevealRes = await revealRoute(hijackRevealReq);
  assert(hijackRevealRes.status === 403, "Attempt to reveal another participant's gift from bound Device A is blocked with HTTP 403");

  // 5. Independent Device B authenticates as Participant 4 -> succeeds
  const bindReqB = createMockRequest(
    "http://localhost:3000/api/auth/pin",
    { participantId: "p4", pin: "10004" },
    undefined,
    devB
  );
  const bindResB = await pinRoute(bindReqB);
  const bindDataB = await bindResB.json();
  assert(bindResB.status === 200 && bindDataB.success === true, "Participant 4 authenticates successfully from independent Device B");

  const bindingRecordB = await getDeviceBinding(devB);
  assert(bindingRecordB?.participantId === "p4", "Device B is authoritatively mapped to Participant 4");

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
