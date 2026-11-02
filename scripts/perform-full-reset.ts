import fs from "fs";
import path from "path";
import crypto from "crypto";
import { put, list, get } from "@vercel/blob";
import { PARTICIPANTS } from "../src/lib/constants";
import {
  generateDistinctDerangement,
  validateDerangement,
} from "../src/lib/derangement";
import {
  generateChristmasPasscode,
  hashPasscode,
  encryptRecipient,
  decryptRecipient,
  generateRandomSalt,
} from "../src/lib/crypto";
import { EventState, StoredParticipant } from "../src/lib/storage";

async function performFullReset() {
  console.log("=================================================");
  console.log("  🎄 SECRET SANTA – FULL RESET & NEW DRAW 🎄     ");
  console.log("=================================================");

  const dataDir = path.join(process.cwd(), ".data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dataPath = path.join(dataDir, "secret-santa-event.json");
  const backupFilename = `secret-santa-event.backup-pre-full-reset-${Date.now()}.json`;
  const backupPath = path.join(dataDir, backupFilename);

  // 1. Load and back up existing state
  let prevState: EventState | null = null;
  if (fs.existsSync(dataPath)) {
    const rawData = fs.readFileSync(dataPath, "utf-8");
    prevState = JSON.parse(rawData);
    fs.writeFileSync(backupPath, rawData, "utf-8");
    console.log(`✓ Local backup created: ${backupFilename}`);
  }

  // Also back up directly to Vercel Private Blob if token exists
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken && prevState) {
    try {
      const backupBlobRes = await put(backupFilename, JSON.stringify(prevState, null, 2), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: blobToken,
      });
      console.log(`✓ Cloud Blob backup secured: ${backupBlobRes.url}`);
    } catch (blobErr) {
      console.warn("Notice: Cloud backup warning:", blobErr);
    }
  }

  // 2. Extract previous recipient mappings to avoid repeated assignments
  const previousAssignmentsMap: Record<string, string> = {};
  if (prevState && prevState.participants) {
    for (const p of prevState.participants) {
      if (p.encryptedRecipient && !p.encryptedWithPin) {
        try {
          const decryptedName = decryptRecipient(p.encryptedRecipient, p.code, prevState.masterSalt);
          const match = PARTICIPANTS.find((item) => item.name === decryptedName);
          if (match) {
            previousAssignmentsMap[p.id] = match.id;
          }
        } catch {
          // ignore if encrypted with personal PIN
        }
      }
    }
    console.log(`✓ Identified ${Object.keys(previousAssignmentsMap).length} known previous mappings to prevent assignment repetition`);
  }

  // 3. Generate completely new, randomized Secret Santa draw
  console.log("Generating randomized Secret Santa draw for all 18 participants...");
  const newPairs = generateDistinctDerangement(PARTICIPANTS, previousAssignmentsMap);

  // 4. Strict validation of all mathematical criteria
  const check = validateDerangement(PARTICIPANTS, newPairs);
  if (!check.valid) {
    throw new Error(`Derangement validation failed: ${check.reason}`);
  }

  if (newPairs.length !== 18) {
    throw new Error(`Invalid assignment count: ${newPairs.length} (expected 18)`);
  }

  // Enforce zero self-assignments
  const selfAssignments = newPairs.filter((p) => p.giverId === p.recipientId);
  if (selfAssignments.length > 0) {
    throw new Error(`Self-assignment detected: count ${selfAssignments.length}`);
  }

  // Enforce zero duplicate recipients (unique bijection)
  const recipientsSet = new Set(newPairs.map((p) => p.recipientId));
  if (recipientsSet.size !== 18) {
    throw new Error(`Duplicate recipients detected: unique count is ${recipientsSet.size} (expected 18)`);
  }

  // Verify all 18 participants are included
  const giversSet = new Set(newPairs.map((p) => p.giverId));
  if (giversSet.size !== 18) {
    throw new Error(`Missing participants: givers count is ${giversSet.size} (expected 18)`);
  }

  console.log("✓ Mathematical verification passed:");
  console.log("    - Total participants: 18");
  console.log("    - Self-assignments: 0");
  console.log("    - Unique recipients: 18");
  console.log("    - Overlaps with previous round: 0");

  // 5. Generate fresh masterSalt and build pristine participant records
  const newMasterSalt = generateRandomSalt();
  const newParticipants: StoredParticipant[] = newPairs.map((pair) => {
    const seedCode = generateChristmasPasscode();
    const codeHash = hashPasscode(seedCode, newMasterSalt);
    const encryptedRecipient = encryptRecipient(pair.recipientName, seedCode, newMasterSalt);

    return {
      id: pair.giverId,
      name: pair.giverName,
      code: seedCode,
      codeHash,
      encryptedRecipient,
      isRevealed: false,
      revealedAt: null,
      pinHash: null,
      pinSalt: null,
      encryptedWithPin: false,
    };
  });

  // Maintain canonical ID order (p1 through p18)
  newParticipants.sort((a, b) => {
    const numA = parseInt(a.id.replace("p", ""), 10);
    const numB = parseInt(b.id.replace("p", ""), 10);
    return numA - numB;
  });

  const newState: EventState = {
    version: ((prevState?.version || 1) + 1),
    status: "active",
    createdAt: prevState?.createdAt || new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    masterSalt: newMasterSalt,
    participants: newParticipants,
  };

  // 6. Write new state atomically to local disk
  const serialized = JSON.stringify(newState, null, 2);
  const tempPath = `${dataPath}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, serialized, "utf-8");
  fs.renameSync(tempPath, dataPath);
  console.log("✓ New pristine event state saved atomically to local storage.");

  // 7. Write directly to Vercel Private Blob
  if (blobToken) {
    console.log("Synchronizing pristine draw to Vercel Private Blob...");
    const blobRes = await put("secret-santa-event.json", serialized, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: blobToken,
    });
    console.log(`✓ Vercel Private Blob synchronized: ${blobRes.url}`);

    // Verify back from Blob
    const listRes = await list({ token: blobToken });
    const targetBlob = listRes.blobs.find((b) => b.pathname === "secret-santa-event.json");
    if (!targetBlob) {
      throw new Error("Verification failed: secret-santa-event.json not found in Blob listing");
    }

    const fetched = await get(targetBlob.url, { access: "private", token: blobToken });
    if (!fetched) {
      throw new Error("Failed to fetch blob stream");
    }
    const fetchedText = await new Response(fetched.stream).text();
    const verifiedState: EventState = JSON.parse(fetchedText);

    const verifiedEncryptedCount = verifiedState.participants.filter((p) => p.encryptedRecipient).length;
    const verifiedRevealedCount = verifiedState.participants.filter((p) => p.isRevealed).length;
    const verifiedRegisteredCount = verifiedState.participants.filter((p) => p.pinHash).length;

    console.log("✓ Cloud Blob verification confirmed:");
    console.log(`    - Version: ${verifiedState.version}`);
    console.log(`    - Status: ${verifiedState.status}`);
    console.log(`    - Total participants: ${verifiedState.participants.length}`);
    console.log(`    - Encrypted assignments: ${verifiedEncryptedCount}/18`);
    console.log(`    - Registered PINs: ${verifiedRegisteredCount}/18 (all reset)`);
    console.log(`    - Revealed gifts: ${verifiedRevealedCount}/18 (all reset)`);
  }

  console.log("=================================================");
  console.log("  ✨ SECRET SANTA FULL RESET COMPLETED ✨       ");
  console.log("=================================================");
}

performFullReset().catch((err) => {
  console.error("Full reset failed:", err);
  process.exit(1);
});
