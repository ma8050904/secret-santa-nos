import fs from "fs";
import path from "path";
import crypto from "crypto";
import { put, list, get } from "@vercel/blob";
import { PARTICIPANTS } from "../src/lib/constants";
import {
  generateConstrainedSecretSantaDraw,
  validateConstrainedSecretSantaDraw,
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
  TARGET_RECIPIENT,
  TARGET_ALLOWED_GIVERS,
} from "../src/lib/derangement";
import {
  encryptRecipient,
  decryptRecipient,
  generateChristmasPasscode,
  hashPasscode,
} from "../src/lib/crypto";

// Load .env.local
if (fs.existsSync(".env.local")) {
  const content = fs.readFileSync(".env.local", "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (!blobToken) {
  throw new Error("BLOB_READ_WRITE_TOKEN is required to execute production draw regeneration.");
}

const KNOWN_BLOB_BASE = "https://ygkog8lebahiid0k.private.blob.vercel-storage.com";

async function run() {
  console.log("=========================================================");
  console.log("  🎄 SECRET SANTA – PRODUCTION REGENERATION (ROUND 6) 🎄 ");
  console.log("=========================================================\n");

  // 1. Verify 48-person roster
  console.log("Step 1: Verifying 48-person roster...");
  if (PARTICIPANTS.length !== 48) {
    throw new Error(`Expected exactly 48 participants, found ${PARTICIPANTS.length}`);
  }
  const uniqueNames = new Set(PARTICIPANTS.map((p) => p.name));
  if (uniqueNames.size !== 48) {
    throw new Error("Participant names are not strictly unique!");
  }
  console.log("  ✅ Roster verified: exactly 48 unique participants in correct order.\n");

  // 2. Fetch current production draw & create secure backup
  console.log("Step 2: Creating secure production backup...");
  const currentBlobRes = await get(`${KNOWN_BLOB_BASE}/secret-santa-event.json`, {
    access: "private",
    token: blobToken,
  });

  if (!currentBlobRes || !currentBlobRes.stream) {
    throw new Error("Failed to read current production blob!");
  }

  const currentRaw = await new Response(currentBlobRes.stream).text();
  const currentState = JSON.parse(currentRaw);

  const timestamp = Date.now();
  const backupBlobKey = `secret-santa-event.backup-pre-round6-${timestamp}.json`;
  await put(backupBlobKey, currentRaw, {
    access: "private",
    addRandomSuffix: false,
    token: blobToken,
  });

  // Local backup
  const localBackupPath = path.join(process.cwd(), ".data", backupBlobKey);
  if (!fs.existsSync(path.dirname(localBackupPath))) {
    fs.mkdirSync(path.dirname(localBackupPath), { recursive: true });
  }
  fs.writeFileSync(localBackupPath, currentRaw, "utf-8");
  console.log(`  ✅ Secure backup created successfully:`);
  console.log(`     Blob: ${backupBlobKey}`);
  console.log(`     Local: .data/${backupBlobKey}\n`);

  // 3. Collect existing participant PIN registrations from v5 to preserve them
  console.log("Step 3: Collecting existing participant PIN registrations to preserve...");
  const preservedPins = new Map<string, { pinHash: string; pinSalt: string }>();

  // Check master state records
  for (const p of currentState.participants || []) {
    if (p.pinHash && p.pinSalt) {
      preservedPins.set(p.id, { pinHash: p.pinHash, pinSalt: p.pinSalt });
    }
  }

  // Check v5 participant blobs
  try {
    const v5List = await list({ prefix: "v5/participants/", token: blobToken });
    for (const b of v5List.blobs) {
      try {
        const itemRes = await get(b.url, { access: "private", token: blobToken });
        if (itemRes && itemRes.stream) {
          const itemText = await new Response(itemRes.stream).text();
          const itemData = JSON.parse(itemText);
          if (itemData.participantId && itemData.pinHash && itemData.pinSalt) {
            preservedPins.set(itemData.participantId, {
              pinHash: itemData.pinHash,
              pinSalt: itemData.pinSalt,
            });
          }
        }
      } catch {
        // ignore individual read miss
      }
    }
  } catch (err) {
    console.warn("  Notice: scanning v5 blob records:", err);
  }

  console.log(`  ✅ Found ${preservedPins.size} existing participant PIN credentials to preserve.\n`);

  // 4. Generate new constrained draw using cryptographically secure random source
  console.log("Step 4: Generating new constrained Secret Santa draw...");
  const newAssignments = generateConstrainedSecretSantaDraw(PARTICIPANTS);

  // 5. Programmatic validation of all constraints
  console.log("Step 5: Validating all constraints programmatically...");
  const validation = validateConstrainedSecretSantaDraw(PARTICIPANTS, newAssignments);
  if (!validation.valid) {
    throw new Error(`CRITICAL: Generated draw failed validation: ${validation.reason}`);
  }

  // Double check all required conditions explicitly
  const map = new Map<string, string>();
  for (const a of newAssignments) {
    map.set(a.giverName, a.recipientName);
  }

  if (map.size !== 48 || new Set(map.values()).size !== 48) {
    throw new Error("Derangement bijection assertion failed!");
  }

  for (const [giver, rec] of map.entries()) {
    if (giver === rec) throw new Error(`Self-assignment detected: ${giver}`);
  }

  if (map.get(MANDATORY_RECIPROCAL_A) !== MANDATORY_RECIPROCAL_B || map.get(MANDATORY_RECIPROCAL_B) !== MANDATORY_RECIPROCAL_A) {
    throw new Error("Mandatory reciprocal Ghazal Baqleh ⇄ George Karkar constraint failed!");
  }

  if (map.get(FORBIDDEN_EXCLUSION_A) === FORBIDDEN_EXCLUSION_B || map.get(FORBIDDEN_EXCLUSION_B) === FORBIDDEN_EXCLUSION_A) {
    throw new Error("Mandatory exclusion Zeina Darawi / Hamza Darawi failed!");
  }

  const giverOfShourati = Array.from(map.entries()).find(([_, rec]) => rec === TARGET_RECIPIENT)?.[0];
  if (!giverOfShourati || !(TARGET_ALLOWED_GIVERS as readonly string[]).includes(giverOfShourati)) {
    throw new Error(`Constraint 3 failed: Giver of Mohammad Shourati is invalid (${giverOfShourati})`);
  }

  const shouratiOccurrences = Array.from(map.values()).filter((r) => r === TARGET_RECIPIENT).length;
  if (shouratiOccurrences !== 1) {
    throw new Error(`Mohammad Shourati assigned ${shouratiOccurrences} times! Expected exactly 1.`);
  }

  console.log("  ✅ Constraint 1 Verified: Ghazal Baqleh ⇄ George Karkar (Reciprocal)");
  console.log("  ✅ Constraint 2 Verified: Zeina Darawi and Hamza Darawi exclusion in both directions");
  console.log("  ✅ Constraint 3 Verified: Mohammad Shourati's giver is one of the 11 allowed names");
  console.log("  ✅ General Draw Rules Verified: 48 givers, 48 unique recipients, 0 self-assignments, 0 duplicates, 0 missing.\n");

  // 6. Build the new Round 6 Event State
  console.log("Step 6: Building new Round 6 encrypted event state...");
  const masterSalt = crypto.randomBytes(16).toString("hex");

  const participantsState = PARTICIPANTS.map((p) => {
    const pair = newAssignments.find((a) => a.giverId === p.id)!;
    const code = generateChristmasPasscode();
    const codeHash = hashPasscode(code, masterSalt);
    const encryptedRecipient = encryptRecipient(pair.recipientName, code, masterSalt);

    const existingPin = preservedPins.get(p.id);

    return {
      id: p.id,
      name: p.name,
      code,
      codeHash,
      encryptedRecipient,
      isRevealed: false,
      revealedAt: null,
      pinHash: existingPin ? existingPin.pinHash : null,
      pinSalt: existingPin ? existingPin.pinSalt : null,
      encryptedWithPin: false, // will be re-encrypted upon first PIN login for Round 6
    };
  });

  const round6State = {
    version: 6,
    status: "active",
    createdAt: currentState.createdAt || new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    masterSalt,
    participants: participantsState,
  };

  // 7. Save atomically to Vercel Blob and local disk
  console.log("Step 7: Saving new Round 6 draw atomically to production...");
  const serialized = JSON.stringify(round6State, null, 2);

  await put("secret-santa-event.json", serialized, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: blobToken,
  });

  const localStatePath = path.join(process.cwd(), ".data", "secret-santa-event.json");
  fs.writeFileSync(localStatePath, serialized, "utf-8");
  console.log("  ✅ Round 6 draw atomically saved to Vercel Blob & local disk.\n");

  // 8. Reset isolated participant v6 runtime blobs with preserved PINs and unrevealed states
  console.log("Step 8: Initializing isolated v6 participant records...");
  let initializedCount = 0;
  for (const p of participantsState) {
    if (p.pinHash && p.pinSalt) {
      const v6Runtime = {
        participantId: p.id,
        name: p.name,
        pinHash: p.pinHash,
        pinSalt: p.pinSalt,
        encryptedRecipient: "", // forces re-encryption upon login
        encryptedWithPin: false,
        isRevealed: false,
        revealedAt: null,
        registeredAt: new Date().toISOString(),
      };
      await put(`v6/participants/${p.id}.json`, JSON.stringify(v6Runtime, null, 2), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: blobToken,
      });
      // Add registered marker
      await put(`v6/registered/${p.id}`, "1", {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: blobToken,
      });
      initializedCount++;
    }
  }
  console.log(`  ✅ Initialized ${initializedCount} participant records in v6 with preserved PINs.\n`);

  // 9. Read back and verify from production blob
  console.log("Step 9: Reading back production state to verify...");
  const readBackRes = await get(`${KNOWN_BLOB_BASE}/secret-santa-event.json?t=${Date.now()}`, {
    access: "private",
    token: blobToken,
  });
  if (!readBackRes || !readBackRes.stream) {
    throw new Error("Failed to read back production state from blob.");
  }
  const readBackText = await new Response(readBackRes.stream).text();
  const readBackState = JSON.parse(readBackText);

  if (readBackState.version !== 6) {
    throw new Error(`Production read-back verification failed: Expected version 6, got ${readBackState.version}`);
  }
  if (readBackState.participants.length !== 48) {
    throw new Error(`Production read-back verification failed: Expected 48 participants, got ${readBackState.participants.length}`);
  }
  const allUnrevealed = readBackState.participants.every((p: any) => p.isRevealed === false);
  if (!allUnrevealed) {
    throw new Error("Production read-back verification failed: Not all participants are unrevealed!");
  }

  console.log("  ✅ Production read-back verified: Version 6, 48 participants, all Ready (unrevealed).\n");
  console.log("=========================================================");
  console.log("  🎄 ROUND 6 DRAW REGENERATION COMPLETED SUCCESSFULLY! 🎄 ");
  console.log("=========================================================");
}

run().catch((err) => {
  console.error("FATAL ERROR during regeneration:", err);
  process.exit(1);
});
