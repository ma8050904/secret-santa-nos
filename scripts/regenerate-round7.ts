import { get, put, list, del } from "@vercel/blob";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import { PARTICIPANTS } from "../src/lib/constants";
import {
  generateConstrainedSecretSantaDraw,
  validateConstrainedSecretSantaDraw,
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
  SUBGROUP_20_IDS,
  SUBGROUP_20_ID_SET,
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

async function executeRound7Migration() {
  console.log("=================================================================");
  console.log("  🎄 SECRET SANTA ROUND 7 — CONTROLLED SUBGROUP MIGRATION 🎄    ");
  console.log("=================================================================\n");

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error("BLOB_READ_WRITE_TOKEN is missing!");
  }

  // 1. Fetch current live production state
  console.log("Step 1: Fetching current live state from Vercel Private Blob...");
  const currentBlobRes: any = await get(`${KNOWN_BLOB_URL}?t=${Date.now()}`, {
    access: "private",
    token: blobToken,
  });

  if (!currentBlobRes || !currentBlobRes.stream) {
    throw new Error("Failed to read current production blob!");
  }

  const currentRaw = await new Response(currentBlobRes.stream).text();
  const currentState = JSON.parse(currentRaw);

  console.log(`  • Existing Round Version: ${currentState.version}`);
  console.log(`  • Existing Status: ${currentState.status}`);
  console.log(`  • Existing Total Participants: ${currentState.participants.length}`);

  if (currentState.participants.length !== 48) {
    throw new Error(`Expected 48 participants, found ${currentState.participants.length}`);
  }

  // 2. Create immutable backup of pre-round 7 state
  const timestamp = Date.now();
  const backupBlobKey = `secret-santa-event.backup-pre-round7-${timestamp}.json`;
  console.log(`\nStep 2: Creating pre-Round 7 backup (${backupBlobKey})...`);
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

  // 3. Generate partitioned Round 7 draw
  console.log("\nStep 3: Generating Round 7 partitioned draw...");
  const newAssignments = generateConstrainedSecretSantaDraw(PARTICIPANTS);

  // 4. Validate constraints programmatically
  console.log("Step 4: Validating all constraints programmatically...");
  const validation = validateConstrainedSecretSantaDraw(PARTICIPANTS, newAssignments);
  if (!validation.valid) {
    throw new Error(`Draw validation failed: ${validation.reason}`);
  }

  // Detailed programmatic checks
  const map = new Map<string, string>();
  const idMap = new Map<string, string>();
  for (const a of newAssignments) {
    map.set(a.giverName, a.recipientName);
    idMap.set(a.giverId, a.recipientId);
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
  for (const a of newAssignments) {
    const gIn20 = SUBGROUP_20_ID_SET.has(a.giverId as any);
    const rIn20 = SUBGROUP_20_ID_SET.has(a.recipientId as any);
    if ((gIn20 && !rIn20) || (!gIn20 && rIn20)) crossCount20++;
  }
  if (crossCount20 !== 0) {
    throw new Error(`Subgroup 20 isolation failed! Cross count: ${crossCount20}`);
  }

  // Check 4: Subgroup 28 isolation
  const remaining28Ids = PARTICIPANTS.filter((p) => !SUBGROUP_20_ID_SET.has(p.id as any)).map((p) => p.id);
  const remaining28Set = new Set(remaining28Ids);
  let crossCount28 = 0;
  for (const a of newAssignments) {
    const gIn28 = remaining28Set.has(a.giverId as any);
    const rIn28 = remaining28Set.has(a.recipientId as any);
    if ((gIn28 && !rIn28) || (!gIn28 && rIn28)) crossCount28++;
  }
  if (crossCount28 !== 0) {
    throw new Error(`Subgroup 28 isolation failed! Cross count: ${crossCount28}`);
  }

  // Check 5: Ghazal <-> George reciprocal
  if (map.get(MANDATORY_RECIPROCAL_A) !== MANDATORY_RECIPROCAL_B || map.get(MANDATORY_RECIPROCAL_B) !== MANDATORY_RECIPROCAL_A) {
    throw new Error("Mandatory reciprocal Ghazal Baqleh ⇄ George Karkar constraint failed!");
  }

  // Check 6: Zeina / Hamza exclusion
  if (map.get(FORBIDDEN_EXCLUSION_A) === FORBIDDEN_EXCLUSION_B || map.get(FORBIDDEN_EXCLUSION_B) === FORBIDDEN_EXCLUSION_A) {
    throw new Error("Mandatory exclusion Zeina Darawi / Hamza Darawi failed!");
  }

  console.log("  ✅ Subgroup 1 Verified: 20 participants, strictly closed (0 cross edges)");
  console.log("  ✅ Subgroup 2 Verified: 28 participants, strictly closed (0 cross edges)");
  console.log("  ✅ Constraint A Verified: Ghazal Baqleh ⇄ George Karkar (Reciprocal)");
  console.log("  ✅ Constraint B Verified: Zeina Darawi ⇎ Hamza Darawi (Mutual Exclusion)");
  console.log("  ✅ General Draw Rules Verified: 48 unique givers, 48 unique recipients, 0 self-assignments.\n");

  // 5. Build Round 7 Event State with AES-256-GCM encrypted assignments
  console.log("Step 5: Building Round 7 encrypted event state...");
  const masterSalt = crypto.randomBytes(16).toString("hex");

  const participantsState = PARTICIPANTS.map((p) => {
    const pair = newAssignments.find((a) => a.giverId === p.id)!;
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

  const round7State = {
    version: 7,
    status: "active",
    createdAt: currentState.createdAt || new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    masterSalt,
    participants: participantsState,
  };

  // 6. Save atomically to Vercel Blob and local disk
  console.log("Step 6: Saving Round 7 state atomically to production...");
  const serialized = JSON.stringify(round7State, null, 2);

  await put("secret-santa-event.json", serialized, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: blobToken,
  });

  const localStatePath = path.join(process.cwd(), ".data", "secret-santa-event.json");
  fs.writeFileSync(localStatePath, serialized, "utf-8");
  console.log("  ✅ Master event state saved to Vercel Blob & local disk.");

  // 7. Clean all runtime blobs under v7/ and previous rounds
  console.log("\nStep 7: Purging residual runtime markers in Blob...");
  for (const prefix of ["v7/", "v6/"]) {
    const prefixList = await list({ prefix, token: blobToken });
    if (prefixList.blobs.length > 0) {
      const urls = prefixList.blobs.map((b) => b.url);
      await del(urls, { token: blobToken });
      console.log(`  • Cleaned ${urls.length} blobs under prefix '${prefix}'.`);
    }
  }

  // Clean local filesystem directories
  const localDataDir = path.join(process.cwd(), ".data");
  for (const d of ["v7_participants", "v7_registered", "v7_revealed", "v6_participants", "v6_registered", "v6_revealed"]) {
    const dirPath = path.join(localDataDir, d);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  // 8. Verification read-back from live Vercel Blob
  console.log("\nStep 8: Verifying read-back from live Vercel Private Blob...");
  let readBackState: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const readBackRes: any = await get(`${KNOWN_BLOB_URL}?t=${Date.now()}`, {
      access: "private",
      token: blobToken,
    });

    if (readBackRes && readBackRes.stream) {
      const readBackRaw = await new Response(readBackRes.stream).text();
      const candidate = JSON.parse(readBackRaw);
      if (candidate.version === 7) {
        readBackState = candidate;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!readBackState) {
    throw new Error("CRITICAL: Failed to read back newly written Round 7 state from Vercel Blob!");
  }

  if (readBackState.version !== 7) {
    throw new Error(`Read-back version mismatch! Expected 7, got ${readBackState.version}`);
  }

  if (readBackState.participants.length !== 48) {
    throw new Error(`Read-back participant count mismatch! Expected 48, got ${readBackState.participants.length}`);
  }

  const decryptedCheckMap = new Map<string, string>();
  for (const p of readBackState.participants) {
    const dec = decryptRecipient(p.encryptedRecipient, p.code, readBackState.masterSalt);
    decryptedCheckMap.set(p.name, dec);
  }

  // Confirm constraints on decrypted data
  if (decryptedCheckMap.get(MANDATORY_RECIPROCAL_A) !== MANDATORY_RECIPROCAL_B) {
    throw new Error("Read-back verification failed on reciprocal constraint!");
  }
  if (decryptedCheckMap.get(FORBIDDEN_EXCLUSION_A) === FORBIDDEN_EXCLUSION_B) {
    throw new Error("Read-back verification failed on exclusion constraint!");
  }

  let rbCrossCount = 0;
  for (const [giver, rec] of decryptedCheckMap.entries()) {
    const gp = PARTICIPANTS.find((p) => p.name === giver)!;
    const rp = PARTICIPANTS.find((p) => p.name === rec)!;
    const gIn20 = SUBGROUP_20_ID_SET.has(gp.id);
    const rIn20 = SUBGROUP_20_ID_SET.has(rp.id);
    if ((gIn20 && !rIn20) || (!gIn20 && rIn20)) rbCrossCount++;
  }
  if (rbCrossCount !== 0) {
    throw new Error("Read-back verification failed on Subgroup 20 isolation!");
  }

  console.log(`  • Version: ${readBackState.version}`);
  console.log(`  • Status: ${readBackState.status}`);
  console.log(`  • Participants: ${readBackState.participants.length}`);
  console.log(`  • Unrevealed Count: ${readBackState.participants.filter((p: any) => !p.isRevealed).length}/48`);
  console.log(`  • Unregistered PIN Count: ${readBackState.participants.filter((p: any) => !p.pinHash).length}/48`);
  console.log(`  • Read-back Subgroup 20 Isolation Verified: TRUE`);
  console.log(`  • Read-back Constraints A & B Verified: TRUE`);

  console.log("\n=================================================================");
  console.log("  🎉 ROUND 7 SUBGROUP MIGRATION COMPLETED SUCCESSFULLY! 🎉       ");
  console.log("=================================================================\n");
}

executeRound7Migration().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
