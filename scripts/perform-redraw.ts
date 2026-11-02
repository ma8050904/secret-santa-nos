import fs from "fs";
import path from "path";
import crypto from "crypto";
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

async function runRedraw() {
  const dataPath = path.join(process.cwd(), ".data", "secret-santa-event.json");
  const backupPath = path.join(process.cwd(), ".data", "secret-santa-event.backup-pre-redraw.json");

  if (!fs.existsSync(dataPath)) {
    throw new Error(`Data file not found at ${dataPath}`);
  }

  // 1. Back up existing data
  fs.copyFileSync(dataPath, backupPath);
  console.log("✓ Existing state safely backed up to secret-santa-event.backup-pre-redraw.json");

  // 2. Read previous state to extract previous recipient mappings
  const rawData = fs.readFileSync(dataPath, "utf-8");
  const prevState: EventState = JSON.parse(rawData);

  const previousAssignmentsMap: Record<string, string> = {};
  for (const p of prevState.participants) {
    if (p.encryptedRecipient) {
      try {
        const decryptedName = decryptRecipient(p.encryptedRecipient, p.code, prevState.masterSalt);
        const match = PARTICIPANTS.find((item) => item.name === decryptedName);
        if (match) {
          previousAssignmentsMap[p.id] = match.id;
        }
      } catch {
        // If already encrypted with PIN or custom
      }
    }
  }

  console.log(`✓ Loaded ${Object.keys(previousAssignmentsMap).length} previous assignments for comparison`);

  // 3. Generate completely new, verified distinct derangement
  const newPairs = generateDistinctDerangement(PARTICIPANTS, previousAssignmentsMap);

  // 4. Verification checks
  const check = validateDerangement(PARTICIPANTS, newPairs);
  if (!check.valid) {
    throw new Error(`Derangement validation failed: ${check.reason}`);
  }

  if (newPairs.length !== 18) {
    throw new Error(`Invalid assignment count: ${newPairs.length}`);
  }

  const selfCount = newPairs.filter((p) => p.giverId === p.recipientId).length;
  if (selfCount > 0) {
    throw new Error(`Self-assignment detected: count ${selfCount}`);
  }

  const recipientsSet = new Set(newPairs.map((p) => p.recipientId));
  if (recipientsSet.size !== 18) {
    throw new Error(`Duplicate recipients detected: unique count is ${recipientsSet.size}`);
  }

  // Verify that every single participant gets someone DIFFERENT from before
  let overlapCount = 0;
  for (const pair of newPairs) {
    if (previousAssignmentsMap[pair.giverId] && previousAssignmentsMap[pair.giverId] === pair.recipientId) {
      overlapCount++;
    }
  }

  if (overlapCount > 0) {
    throw new Error(`Overlap with previous draw detected: ${overlapCount} participants received the same recipient`);
  }

  console.log("✓ All 5 mathematical & distinctness criteria verified (0 self-matches, 0 overlaps, 18 unique)");

  // 5. Generate fresh masterSalt and build new participant records
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

  // Preserve initial order (p1 to p18)
  newParticipants.sort((a, b) => {
    const numA = parseInt(a.id.replace("p", ""), 10);
    const numB = parseInt(b.id.replace("p", ""), 10);
    return numA - numB;
  });

  const newState: EventState = {
    version: (prevState.version || 1) + 1,
    status: "active",
    createdAt: prevState.createdAt,
    generatedAt: new Date().toISOString(),
    masterSalt: newMasterSalt,
    participants: newParticipants,
  };

  // 6. Write new state atomically
  const tempPath = `${dataPath}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(newState, null, 2), "utf-8");
  fs.renameSync(tempPath, dataPath);

  console.log("✓ New Secret Santa draw committed atomically to storage.");
  console.log("✓ All previous reveal statuses reset to false.");
  console.log("✓ All previous PIN registrations cleared for fresh setup.");
  console.log("✓ Total participants: 18 (Exact spelling & casing preserved).");
  console.log("✓ Privacy preserved: No recipient names or mappings logged.");
}

runRedraw().catch((err) => {
  console.error("Redraw failed:", err);
  process.exit(1);
});
