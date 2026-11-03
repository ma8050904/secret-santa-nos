import { get, put, list, del } from "@vercel/blob";
import * as fs from "fs";
import * as path from "path";
import { PARTICIPANTS } from "../src/lib/constants";
import { decryptRecipient } from "../src/lib/crypto";

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

const SHOURATI_ALLOWED_GIVERS = [
  "Michael Shamma",
  "Mohammad Darras",
  "Qais Al-Hadeed",
  "Yara Barjawi",
  "Zeina Darawi",
  "Joewelle Ehab",
  "Joseph Dababneh",
  "George Shammas",
  "Toleen Awwad",
  "Wasan Abu Hamdeh",
  "Hamza Darawi",
];

async function resetAllParticipantPins() {
  console.log("=================================================================");
  console.log("  🔒 ROUND 6 — RESET ALL PARTICIPANT PINS & SESSIONS 🔒          ");
  console.log("=================================================================\n");

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error("BLOB_READ_WRITE_TOKEN is missing!");
  }

  // 1. Fetch current live production state
  console.log("Step 1: Fetching current live Round 6 state from Vercel Private Blob...");
  const currentBlobRes: any = await get(`${KNOWN_BLOB_URL}?t=${Date.now()}`, {
    access: "private",
    token: blobToken,
  });

  if (!currentBlobRes || !currentBlobRes.stream) {
    throw new Error("Failed to read current production blob!");
  }

  const currentRaw = await new Response(currentBlobRes.stream).text();
  const currentState = JSON.parse(currentRaw);

  if (currentState.version !== 6) {
    throw new Error(`Expected Round 6, found version ${currentState.version}`);
  }

  if (currentState.participants.length !== 48) {
    throw new Error(`Expected 48 participants, found ${currentState.participants.length}`);
  }

  console.log(`  • Version: ${currentState.version}`);
  console.log(`  • Status: ${currentState.status}`);
  console.log(`  • Total Participants: ${currentState.participants.length}`);

  // 2. Snapshot byte-for-byte assignment records for immutability verification
  const preResetSnapshot = new Map<string, { encryptedRecipient: string; code: string; codeHash: string }>();
  for (const p of currentState.participants) {
    preResetSnapshot.set(p.id, {
      encryptedRecipient: p.encryptedRecipient,
      code: p.code,
      codeHash: p.codeHash,
    });
  }

  // 3. Create pre-reset backup in Vercel Blob and local disk
  const timestamp = Date.now();
  const backupBlobKey = `secret-santa-event.backup-pre-pinreset-${timestamp}.json`;
  console.log(`\nStep 2: Creating pre-reset backup (${backupBlobKey})...`);
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

  // 4. Reset PIN fields on all 48 participants while keeping assignments 100% untouched
  console.log("\nStep 3: Resetting PIN fields on all 48 participants...");
  for (const p of currentState.participants) {
    p.pinHash = null;
    p.pinSalt = null;
    p.encryptedWithPin = false;
    p.isRevealed = false;
    p.revealedAt = null;
  }

  const serializedUpdated = JSON.stringify(currentState, null, 2);

  // Write updated master state back to Vercel Blob and local file
  await put("secret-santa-event.json", serializedUpdated, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: blobToken,
  });

  const localMasterPath = path.join(process.cwd(), ".data", "secret-santa-event.json");
  fs.writeFileSync(localMasterPath, serializedUpdated, "utf-8");
  console.log("  ✅ Updated master state persisted to Vercel Private Blob and local disk.");

  // 5. Delete all runtime participant blobs under 'v6/' (and legacy 'v5/')
  console.log("\nStep 4: Deleting active participant runtime blobs and markers...");
  const v6List = await list({ prefix: "v6/", token: blobToken });
  if (v6List.blobs.length > 0) {
    console.log(`  • Found ${v6List.blobs.length} blobs under 'v6/' to delete.`);
    const urls = v6List.blobs.map((b) => b.url);
    await del(urls, { token: blobToken });
    console.log(`  ✅ Deleted ${urls.length} blobs under 'v6/'.`);
  } else {
    console.log("  • No blobs found under 'v6/'.");
  }

  // Also clean up any residual v5 blobs to guarantee no old PINs remain
  const v5List = await list({ prefix: "v5/", token: blobToken });
  if (v5List.blobs.length > 0) {
    console.log(`  • Found ${v5List.blobs.length} blobs under 'v5/' to delete.`);
    const urlsV5 = v5List.blobs.map((b) => b.url);
    await del(urlsV5, { token: blobToken });
    console.log(`  ✅ Deleted ${urlsV5.length} legacy blobs under 'v5/'.`);
  }

  // 6. Clean local filesystem runtime directories
  console.log("\nStep 5: Cleaning local runtime storage directories...");
  const localDataDir = path.join(process.cwd(), ".data");
  for (const dirName of ["v6_participants", "v6_registered", "v6_revealed", "v5_participants", "v5_registered", "v5_revealed"]) {
    const dirPath = path.join(localDataDir, dirName);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  console.log("  ✅ Local runtime storage directories cleaned.");

  // 7. Verification read-back from live Vercel Blob
  console.log("\nStep 6: Verifying read-back from live Vercel Private Blob...");
  const verifyRes: any = await get(`${KNOWN_BLOB_URL}?t=${Date.now()}`, {
    access: "private",
    token: blobToken,
  });

  if (!verifyRes || !verifyRes.stream) {
    throw new Error("Failed to read back verification state from Vercel Blob!");
  }

  const verifyRaw = await new Response(verifyRes.stream).text();
  const verifyState = JSON.parse(verifyRaw);

  const registeredPinsCount = verifyState.participants.filter((p: any) => p.pinHash || p.pinSalt).length;
  const revealedCount = verifyState.participants.filter((p: any) => p.isRevealed).length;

  console.log(`  • Round Version: ${verifyState.version}`);
  console.log(`  • Total Participants: ${verifyState.participants.length}`);
  console.log(`  • Registered PIN Count: ${registeredPinsCount}/48`);
  console.log(`  • Revealed Count: ${revealedCount}/48`);

  if (registeredPinsCount !== 0) {
    throw new Error(`CRITICAL: Expected 0 registered PINs, found ${registeredPinsCount}`);
  }

  if (revealedCount !== 0) {
    throw new Error(`CRITICAL: Expected 0 revealed participants, found ${revealedCount}`);
  }

  // 8. Byte-for-byte assignment immutability check
  console.log("\nStep 7: Verifying byte-for-byte assignment preservation...");
  let byteForByteMatches = true;
  for (const p of verifyState.participants) {
    const snap = preResetSnapshot.get(p.id);
    if (!snap) {
      byteForByteMatches = false;
      throw new Error(`Participant ${p.id} missing in pre-reset snapshot!`);
    }
    if (p.encryptedRecipient !== snap.encryptedRecipient) {
      byteForByteMatches = false;
      throw new Error(`Participant ${p.name} encryptedRecipient mutated!`);
    }
    if (p.code !== snap.code || p.codeHash !== snap.codeHash) {
      byteForByteMatches = false;
      throw new Error(`Participant ${p.name} seed code mutated!`);
    }
  }
  console.log(`  ✅ Byte-for-byte assignment match: ${byteForByteMatches} (All 48 identical)`);

  // 9. Verify draw constraints remain 100% intact
  console.log("\nStep 8: Verifying draw constraints on preserved assignments...");
  const masterSalt = verifyState.masterSalt;
  const decryptedRecipients = new Map<string, string>();
  for (const p of verifyState.participants) {
    const recipient = decryptRecipient(p.encryptedRecipient, p.code, masterSalt);
    decryptedRecipients.set(p.name, recipient);
  }

  // Mandatory reciprocal: Ghazal Baqleh ⇄ George Karkar
  const ghazalRecipient = decryptedRecipients.get("Ghazal Baqleh");
  const georgeRecipient = decryptedRecipients.get("George Karkar");
  const reciprocalValid = ghazalRecipient === "George Karkar" && georgeRecipient === "Ghazal Baqleh";

  // Mandatory exclusion: Zeina Darawi ⇎ Hamza Darawi
  const zeinaRecipient = decryptedRecipients.get("Zeina Darawi");
  const hamzaRecipient = decryptedRecipients.get("Hamza Darawi");
  const exclusionValid = zeinaRecipient !== "Hamza Darawi" && hamzaRecipient !== "Zeina Darawi";

  // Constraint 3: Mohammad Shourati giver in 11 list
  const shouratiGivers = Array.from(decryptedRecipients.entries()).filter(([_, r]) => r === "Mohammad Shourati").map(([g]) => g);
  const shouratiValid = shouratiGivers.length === 1 && SHOURATI_ALLOWED_GIVERS.includes(shouratiGivers[0]);

  // Bijection & no self assignments
  const uniqueRecipients = new Set(decryptedRecipients.values());
  const selfAssignments = Array.from(decryptedRecipients.entries()).filter(([g, r]) => g === r).length;

  console.log(`  ✅ Constraint 1 (Ghazal Baqleh ⇄ George Karkar): ${reciprocalValid}`);
  console.log(`  ✅ Constraint 2 (Zeina Darawi ⇎ Hamza Darawi): ${exclusionValid}`);
  console.log(`  ✅ Constraint 3 (Mohammad Shourati giver in 11 list): ${shouratiValid}`);
  console.log(`  ✅ Bijection (48 unique recipients): ${uniqueRecipients.size === 48}`);
  console.log(`  ✅ Zero Self-Assignments: ${selfAssignments === 0}`);

  // 10. Check that prefix 'v6/' has 0 blobs left
  const postList = await list({ prefix: "v6/", token: blobToken });
  console.log(`  • Residual blobs with prefix 'v6/': ${postList.blobs.length}`);
  if (postList.blobs.length !== 0) {
    throw new Error(`CRITICAL: Expected 0 residual blobs with prefix 'v6/', found ${postList.blobs.length}`);
  }

  console.log("\n=================================================================");
  console.log("  🎉 ROUND 6 PIN RESET COMPLETED & VERIFIED SUCCESSFULLY 🎉     ");
  console.log("=================================================================\n");
}

resetAllParticipantPins().catch((err) => {
  console.error("PIN reset error:", err);
  process.exit(1);
});
