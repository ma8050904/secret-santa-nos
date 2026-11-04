import { get, put, list, del } from "@vercel/blob";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import { PARTICIPANTS } from "../src/lib/constants";
import {
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
  SUBGROUP_20_IDS,
  SUBGROUP_20_ID_SET,
  AssignmentPair,
} from "../src/lib/derangement";
import {
  generateChristmasPasscode,
  hashPasscode,
  encryptRecipient,
  decryptRecipient,
} from "../src/lib/crypto";

// Load environment variables from .env.local
if (fs.existsSync(".env.local")) {
  const content = fs.readFileSync(".env.local", "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const KNOWN_BLOB_BASE = "https://ygkog8lebahiid0k.private.blob.vercel-storage.com";
const KNOWN_BLOB_URL = `${KNOWN_BLOB_BASE}/secret-santa-event.json`;

function generateFreshSubgroup20Pairs(
  subgroup20Participants: readonly any[],
  previousP28RecipientName?: string
): AssignmentPair[] {
  const ghazal = subgroup20Participants.find((p) => p.name === MANDATORY_RECIPROCAL_A);
  const george = subgroup20Participants.find((p) => p.name === MANDATORY_RECIPROCAL_B);

  if (!ghazal || !george) {
    throw new Error("Mandatory participants Ghazal or George not found in Subgroup 20!");
  }

  const remaining = subgroup20Participants.filter(
    (p) => p.name !== MANDATORY_RECIPROCAL_A && p.name !== MANDATORY_RECIPROCAL_B
  );

  let attempts = 0;
  const maxAttempts = 20000;

  while (attempts < maxAttempts) {
    attempts++;

    // Permute remaining 18 participants using Sattolo algorithm (guarantees single cycle derangement)
    const listArr = [...remaining];
    for (let i = listArr.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i);
      const temp = listArr[i];
      listArr[i] = listArr[j];
      listArr[j] = temp;
    }

    const pairs: AssignmentPair[] = [];
    let hasViolation = false;

    for (let i = 0; i < listArr.length; i++) {
      const giver = listArr[i];
      const recipient = listArr[(i + 1) % listArr.length];

      // Check Zeina / Hamza exclusion
      if (
        (giver.name === FORBIDDEN_EXCLUSION_A && recipient.name === FORBIDDEN_EXCLUSION_B) ||
        (giver.name === FORBIDDEN_EXCLUSION_B && recipient.name === FORBIDDEN_EXCLUSION_A)
      ) {
        hasViolation = true;
        break;
      }

      // Check that Mohammad Shourati gets a fresh recipient
      if (giver.id === "p28" && previousP28RecipientName && recipient.name === previousP28RecipientName) {
        hasViolation = true;
        break;
      }

      pairs.push({
        giverId: giver.id,
        giverName: giver.name,
        recipientId: recipient.id,
        recipientName: recipient.name,
      });
    }

    if (hasViolation) continue;

    // Add fixed reciprocal pair: Ghazal Baqleh ⇄ George Karkar
    pairs.push({
      giverId: ghazal.id,
      giverName: ghazal.name,
      recipientId: george.id,
      recipientName: george.name,
    });
    pairs.push({
      giverId: george.id,
      giverName: george.name,
      recipientId: ghazal.id,
      recipientName: ghazal.name,
    });

    return pairs;
  }

  throw new Error(`Failed to generate fresh Subgroup 20 draw after ${maxAttempts} attempts.`);
}

async function reseedSubgroup20() {
  console.log("=================================================================");
  console.log("  🎄 SECRET SANTA ROUND 7 — SUBGROUP 20 CONTROLLED RESEED 🎄    ");
  console.log("=================================================================\n");

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error("BLOB_READ_WRITE_TOKEN is missing!");
  }

  // 1. Fetch current live state from Vercel Private Blob
  console.log("Step 1: Reading live state from Vercel Private Blob...");
  const currentBlobRes: any = await get(`${KNOWN_BLOB_URL}?t=${Date.now()}`, {
    access: "private",
    token: blobToken,
  });

  if (!currentBlobRes || !currentBlobRes.stream) {
    throw new Error("Failed to read current production blob!");
  }

  const currentRaw = await new Response(currentBlobRes.stream).text();
  const currentState = JSON.parse(currentRaw);

  console.log(`  • Version: ${currentState.version}`);
  console.log(`  • Total Participants: ${currentState.participants.length}`);

  // 2. Backup current state
  const timestamp = Date.now();
  const backupBlobKey = `secret-santa-event.backup-pre-reseed-subgroup20-${timestamp}.json`;
  console.log(`\nStep 2: Creating pre-reseed backup (${backupBlobKey})...`);
  await put(backupBlobKey, currentRaw, {
    access: "private",
    addRandomSuffix: false,
    token: blobToken,
  });

  const localBackupPath = path.join(process.cwd(), ".data", backupBlobKey);
  if (!fs.existsSync(path.dirname(localBackupPath))) {
    fs.mkdirSync(path.dirname(localBackupPath), { recursive: true });
  }
  fs.writeFileSync(localBackupPath, currentRaw, "utf-8");
  console.log(`  ✅ Backup saved in Blob: ${backupBlobKey}`);
  console.log(`  ✅ Backup saved in Local: .data/${backupBlobKey}`);

  // 3. Extract and preserve the 28 participants' assignments
  console.log("\nStep 3: Extracting and preserving existing 28 participants' assignments...");
  const preserved28Pairs: AssignmentPair[] = [];
  const participants28 = currentState.participants.filter(
    (p: any) => !SUBGROUP_20_ID_SET.has(p.id as any)
  );

  if (participants28.length !== 28) {
    throw new Error(`Expected 28 participants outside Subgroup 20, found ${participants28.length}`);
  }

  for (const p of participants28) {
    const recName = decryptRecipient(p.encryptedRecipient, p.code, currentState.masterSalt);
    const recP = PARTICIPANTS.find((item) => item.name === recName);
    if (!recP) {
      throw new Error(`Failed to resolve preserved recipient for ${p.name}`);
    }
    preserved28Pairs.push({
      giverId: p.id,
      giverName: p.name,
      recipientId: recP.id,
      recipientName: recP.name,
    });
  }

  console.log(`  ✅ Preserved exactly ${preserved28Pairs.length} assignments for the other 28 participants.`);

  // 4. Find previous recipient of p28 (Mohammad Shourati) to guarantee a different recipient
  const p28Current = currentState.participants.find((p: any) => p.id === "p28");
  const previousP28Recipient = p28Current
    ? decryptRecipient(p28Current.encryptedRecipient, p28Current.code, currentState.masterSalt)
    : undefined;

  // 5. Generate fresh assignments for Subgroup 20
  console.log("\nStep 4: Generating fresh randomized draw for Subgroup 20...");
  const subgroup20Participants = PARTICIPANTS.filter((p) => SUBGROUP_20_ID_SET.has(p.id as any));
  const newSubgroup20Pairs = generateFreshSubgroup20Pairs(
    subgroup20Participants,
    previousP28Recipient
  );

  console.log(`  ✅ Subgroup 20 generated (${newSubgroup20Pairs.length} pairs).`);

  // 6. Combine and validate the complete 48 assignments
  console.log("\nStep 5: Combining and validating all 48 assignments...");
  const all48Assignments: AssignmentPair[] = [...newSubgroup20Pairs, ...preserved28Pairs];

  const map = new Map<string, string>();
  for (const a of all48Assignments) {
    map.set(a.giverName, a.recipientName);
  }

  // Check 1: 48 bijection
  if (map.size !== 48 || new Set(map.values()).size !== 48) {
    throw new Error("Bijection violation across 48 participants!");
  }

  // Check 2: 0 self assignments
  for (const [giver, rec] of map.entries()) {
    if (giver === rec) throw new Error(`Self-assignment detected: ${giver}`);
  }

  // Check 3: Subgroup 20 isolation
  let crossCount20 = 0;
  for (const a of all48Assignments) {
    const gIn20 = SUBGROUP_20_ID_SET.has(a.giverId as any);
    const rIn20 = SUBGROUP_20_ID_SET.has(a.recipientId as any);
    if ((gIn20 && !rIn20) || (!gIn20 && rIn20)) crossCount20++;
  }
  if (crossCount20 !== 0) {
    throw new Error(`Subgroup 20 isolation failed! Cross count: ${crossCount20}`);
  }

  // Check 4: Subgroup 28 isolation
  const remaining28Set = new Set(participants28.map((p: any) => p.id));
  let crossCount28 = 0;
  for (const a of all48Assignments) {
    const gIn28 = remaining28Set.has(a.giverId);
    const rIn28 = remaining28Set.has(a.recipientId);
    if ((gIn28 && !rIn28) || (!gIn28 && rIn28)) crossCount28++;
  }
  if (crossCount28 !== 0) {
    throw new Error(`Subgroup 28 isolation failed! Cross count: ${crossCount28}`);
  }

  // Check 5: Ghazal <-> George reciprocal
  if (
    map.get(MANDATORY_RECIPROCAL_A) !== MANDATORY_RECIPROCAL_B ||
    map.get(MANDATORY_RECIPROCAL_B) !== MANDATORY_RECIPROCAL_A
  ) {
    throw new Error("Mandatory reciprocal Ghazal Baqleh ⇄ George Karkar failed!");
  }

  // Check 6: Zeina / Hamza exclusion
  if (
    map.get(FORBIDDEN_EXCLUSION_A) === FORBIDDEN_EXCLUSION_B ||
    map.get(FORBIDDEN_EXCLUSION_B) === FORBIDDEN_EXCLUSION_A
  ) {
    throw new Error("Mandatory exclusion Zeina Darawi / Hamza Darawi failed!");
  }

  // Check 7: Mohammad Shourati recipient is fresh
  const p28NewRecipient = map.get("Mohammad Shourati");
  if (p28NewRecipient === previousP28Recipient) {
    throw new Error("Mohammad Shourati received the exact same recipient as previous draw!");
  }

  console.log("  ✅ Subgroup 1 (20 participants) strictly closed (0 cross edges)");
  console.log("  ✅ Subgroup 2 (28 participants) strictly closed (0 cross edges, 100% preserved)");
  console.log("  ✅ Ghazal Baqleh ⇄ George Karkar reciprocal constraint verified");
  console.log("  ✅ Zeina Darawi ⇎ Hamza Darawi mutual exclusion verified");
  console.log("  ✅ Mohammad Shourati recipient re-randomized and changed successfully");
  console.log("  ✅ All 48 unique givers, 48 unique recipients, 0 self-assignments.\n");

  // 7. Encrypt new event state
  console.log("Step 6: Encrypting event state with new masterSalt & fresh passcodes...");
  const newMasterSalt = crypto.randomBytes(16).toString("hex");

  const participantsState = PARTICIPANTS.map((p) => {
    const pair = all48Assignments.find((a) => a.giverId === p.id)!;
    const code = generateChristmasPasscode();
    const codeHash = hashPasscode(code, newMasterSalt);
    const encryptedRecipient = encryptRecipient(pair.recipientName, code, newMasterSalt);

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

  const updatedRound7State = {
    version: 7,
    status: "active",
    createdAt: currentState.createdAt || new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    masterSalt: newMasterSalt,
    participants: participantsState,
  };

  // 8. Atomically save to Vercel Blob and local disk
  console.log("Step 7: Saving reseeded state to Vercel Private Blob...");
  const serialized = JSON.stringify(updatedRound7State, null, 2);

  await put("secret-santa-event.json", serialized, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: blobToken,
  });

  const localStatePath = path.join(process.cwd(), ".data", "secret-santa-event.json");
  fs.writeFileSync(localStatePath, serialized, "utf-8");
  console.log("  ✅ Master event state saved to Vercel Blob & local disk.");

  // 9. Purge all dynamic runtime markers & devices under v7/
  console.log("\nStep 8: Purging dynamic runtime markers & device bindings in Blob...");
  const v7List = await list({ prefix: "v7/", token: blobToken });
  if (v7List.blobs.length > 0) {
    const urls = v7List.blobs.map((b) => b.url);
    await del(urls, { token: blobToken });
    console.log(`  • Purged ${urls.length} blobs under prefix 'v7/'.`);
  }

  // Clean local filesystem directories
  const localDataDir = path.join(process.cwd(), ".data");
  for (const d of [
    "v7_participants",
    "v7_registered",
    "v7_revealed",
    "v7_devices",
  ]) {
    const dirPath = path.join(localDataDir, d);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  // 10. Read-back verification
  console.log("\nStep 9: Verifying read-back from live Vercel Private Blob...");
  let readBackState: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const readBackRes: any = await get(`${KNOWN_BLOB_URL}?t=${Date.now()}`, {
      access: "private",
      token: blobToken,
    });

    if (readBackRes && readBackRes.stream) {
      const readBackRaw = await new Response(readBackRes.stream).text();
      const candidate = JSON.parse(readBackRaw);
      if (candidate.masterSalt === newMasterSalt) {
        readBackState = candidate;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!readBackState) {
    throw new Error("CRITICAL: Failed to verify updated state from Vercel Blob!");
  }

  console.log(`  • Version: ${readBackState.version}`);
  console.log(`  • Status: ${readBackState.status}`);
  console.log(`  • Participants: ${readBackState.participants.length}`);
  console.log(`  • Unrevealed Count: ${readBackState.participants.filter((p: any) => !p.isRevealed).length}/48`);
  console.log(`  • Unregistered PIN Count: ${readBackState.participants.filter((p: any) => !p.pinHash).length}/48`);

  console.log("\n=================================================================");
  console.log("  🎉 SUBGROUP 20 RESEED COMPLETED SUCCESSFULLY! 🎉               ");
  console.log("=================================================================\n");
}

reseedSubgroup20().catch((err) => {
  console.error("Reseed error:", err);
  process.exit(1);
});
