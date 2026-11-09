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
  FORBIDDEN_EXCLUSION_C,
  FORBIDDEN_EXCLUSION_D,
  SUBGROUP_20_IDS,
  SUBGROUP_20_ID_SET,
} from "../src/lib/derangement";
import {
  generateChristmasPasscode,
  hashPasscode,
  encryptRecipient,
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

async function main() {
  console.log("=================================================================");
  console.log("  🎄 SECRET SANTA ROUND 15 — 55 PARTICIPANTS MIGRATION 🎄        ");
  console.log("=================================================================\n");

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error("BLOB_READ_WRITE_TOKEN is missing!");
  }

  // 1. Fetch current live state
  console.log("Step 1: Fetching current live state from Vercel Private Blob...");
  const currentBlobRes: any = await get(KNOWN_BLOB_URL, {
    access: "private",
    token: blobToken,
  });

  let currentRaw = "";
  if (currentBlobRes && currentBlobRes.stream) {
    currentRaw = await new Response(currentBlobRes.stream).text();
    const currentState = JSON.parse(currentRaw);
    console.log(`  • Existing Round Version: ${currentState.version}`);
    console.log(`  • Existing Total Participants: ${currentState.participants.length}`);
  }

  // 2. Create automated backup of current state
  const timestamp = Date.now();
  const backupBlobKey = `secret-santa-event.backup-pre-round15-55participants-${timestamp}.json`;
  if (currentRaw) {
    console.log(`\nStep 2: Creating automated backup (${backupBlobKey})...`);
    await put(backupBlobKey, currentRaw, {
      access: "private",
      addRandomSuffix: false,
      token: blobToken,
    });
    const localBackupDir = path.join(process.cwd(), ".data");
    if (!fs.existsSync(localBackupDir)) fs.mkdirSync(localBackupDir, { recursive: true });
    fs.writeFileSync(path.join(localBackupDir, backupBlobKey), currentRaw, "utf-8");
    console.log(`  ✅ Backup saved in Blob & Local disk: ${backupBlobKey}`);
  }

  // 3. Generate partitioned draw for all 55 participants
  console.log(`\nStep 3: Generating Round 15 draw for all ${PARTICIPANTS.length} participants...`);
  console.log(`  • Subgroup 1 (Designated): ${SUBGROUP_20_IDS.length} participants (includes Diana, Fadi, Njoud, Raghad)`);
  console.log(`  • Subgroup 2 (Remaining): ${PARTICIPANTS.length - SUBGROUP_20_IDS.length} participants`);

  const newAssignments = generateConstrainedSecretSantaDraw(PARTICIPANTS);

  // 4. Validate all constraints programmatically
  console.log("\nStep 4: Validating all constraints programmatically...");
  const validation = validateConstrainedSecretSantaDraw(PARTICIPANTS, newAssignments);
  if (!validation.valid) {
    throw new Error(`Draw validation failed: ${validation.reason}`);
  }

  const map = new Map<string, string>();
  for (const a of newAssignments) {
    map.set(a.giverName, a.recipientName);
  }

  // Check Reciprocal
  if (
    map.get(MANDATORY_RECIPROCAL_A) !== MANDATORY_RECIPROCAL_B ||
    map.get(MANDATORY_RECIPROCAL_B) !== MANDATORY_RECIPROCAL_A
  ) {
    throw new Error("Reciprocal pairing verification failed!");
  }
  console.log(`  ✅ Mandatory reciprocal: ${MANDATORY_RECIPROCAL_A} ⇄ ${MANDATORY_RECIPROCAL_B}`);

  // Check Exclusion 1
  if (
    map.get(FORBIDDEN_EXCLUSION_A) === FORBIDDEN_EXCLUSION_B ||
    map.get(FORBIDDEN_EXCLUSION_B) === FORBIDDEN_EXCLUSION_A
  ) {
    throw new Error("Zeina <-> Hamza exclusion failed!");
  }
  console.log(`  ✅ Mandatory exclusion: ${FORBIDDEN_EXCLUSION_A} ⇎ ${FORBIDDEN_EXCLUSION_B}`);

  // Check Exclusion 2
  if (
    map.get(FORBIDDEN_EXCLUSION_C) === FORBIDDEN_EXCLUSION_D ||
    map.get(FORBIDDEN_EXCLUSION_D) === FORBIDDEN_EXCLUSION_C
  ) {
    throw new Error("Raghad <-> Mohammad exclusion failed!");
  }
  console.log(`  ✅ Mandatory exclusion: ${FORBIDDEN_EXCLUSION_C} ⇎ ${FORBIDDEN_EXCLUSION_D}`);

  // Check Subgroup Isolation
  let subCrossEdges = 0;
  for (const a of newAssignments) {
    const giverInSub = SUBGROUP_20_ID_SET.has(a.giverId);
    const recInSub = SUBGROUP_20_ID_SET.has(a.recipientId);
    if (giverInSub !== recInSub) {
      subCrossEdges++;
    }
  }
  if (subCrossEdges !== 0) {
    throw new Error(`Subgroup isolation violation: found ${subCrossEdges} cross edges!`);
  }
  console.log(`  ✅ Subgroup isolation: 0 cross edges between 24-subgroup and remaining 31 participants.`);

  // 5. Encrypt with new Master Salt
  console.log("\nStep 5: Encrypting assignments with new Master Salt...");
  const newMasterSalt = crypto.randomBytes(16).toString("hex");
  const newVersion = 15;

  const newParticipantsState = PARTICIPANTS.map((p) => {
    const pair = newAssignments.find((a) => a.giverId === p.id)!;
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

  const newState = {
    version: newVersion,
    status: "active",
    createdAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    masterSalt: newMasterSalt,
    participants: newParticipantsState,
  };

  const serialized = JSON.stringify(newState, null, 2);

  // 6. Write to Vercel Private Blob & local disk
  console.log("\nStep 6: Writing new state to Vercel Private Blob...");
  await put("secret-santa-event.json", serialized, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: blobToken,
  });

  const localStatePath = path.join(process.cwd(), ".data", "secret-santa-event.json");
  if (!fs.existsSync(path.dirname(localStatePath))) fs.mkdirSync(path.dirname(localStatePath), { recursive: true });
  fs.writeFileSync(localStatePath, serialized, "utf-8");

  // 7. Clean runtime blobs
  console.log("Step 7: Cleaning stale runtime markers in Vercel Blob...");
  const vList = await list({ prefix: "v7/", token: blobToken });
  const urlsToDelete = vList.blobs
    .filter((b) => !b.pathname.includes("admin_audit_logs"))
    .map((b) => b.url);
  if (urlsToDelete.length > 0) {
    await del(urlsToDelete, { token: blobToken });
    console.log(`  ✅ Cleaned ${urlsToDelete.length} stale runtime markers.`);
  }

  // 8. Final read-back verification from Vercel Blob
  console.log("\nStep 8: Performing live read-back verification from Blob...");
  let verifiedState: any = null;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const verifyRes: any = await get(KNOWN_BLOB_URL, {
        access: "private",
        token: blobToken,
      });
      const verifyRaw = await new Response(verifyRes.stream).text();
      const parsed = JSON.parse(verifyRaw);
      if (parsed.version === newVersion && parsed.participants.length === 55) {
        verifiedState = parsed;
        break;
      }
      console.log(`  • Attempt ${attempt}: version=${parsed.version}, count=${parsed.participants.length}, retrying...`);
    } catch (err) {
      console.log(`  • Attempt ${attempt} failed: ${err}, retrying...`);
    }
  }

  if (!verifiedState || verifiedState.version !== newVersion || verifiedState.participants.length !== 55) {
    throw new Error(`Read-back verification mismatch: version=${verifiedState?.version}, count=${verifiedState?.participants.length}`);
  }

  console.log("=================================================================");
  console.log(`  🎉 SUCCESS! ROUND 15 DEPLOYED WITH 55 PARTICIPANTS 🎉           `);
  console.log(`  • Version: ${verifiedState.version}`);
  console.log(`  • Total Participants: ${verifiedState.participants.length}`);
  console.log(`  • All 55 in clean unrevealed state, ready for PIN setup`);
  console.log("=================================================================");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
