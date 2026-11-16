import fs from "fs";
import path from "path";
import { PARTICIPANTS } from "../src/lib/constants";
import {
  FORBIDDEN_EXCLUSION_C,
  FORBIDDEN_EXCLUSION_D,
  MANDATORY_DIRECTED_GIVER_2,
  MANDATORY_DIRECTED_RECIPIENT_2,
  MANDATORY_DIRECTED_GIVER_3,
  MANDATORY_DIRECTED_RECIPIENT_3,
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  SUBGROUP_20_IDS,
  SUBGROUP_20_ID_SET,
  validateConstrainedSecretSantaDraw,
  AssignmentPair,
} from "../src/lib/derangement";
import { decryptRecipient } from "../src/lib/crypto";
import { getPostgresEventState, getDbClient } from "../src/lib/db";
import { regenerateFullDraw } from "../src/lib/storage";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  loadEnvLocal();
  delete process.env.STORAGE_FILE_PATH;

  const sql = getDbClient();
  if (!sql) {
    throw new Error("DATABASE_URL is not configured in .env.local");
  }

  // 1. Backup current live PostgreSQL state before regenerating
  const prePgState = await getPostgresEventState();
  if (!prePgState) {
    throw new Error("Could not read live master_event_state from PostgreSQL");
  }

  const ts = Date.now();
  const backupDir = path.join(process.cwd(), "backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const preBackupPath = path.join(backupDir, `backup-pre-hamza-zeina-round${prePgState.version}-${ts}.json`);
  fs.writeFileSync(preBackupPath, JSON.stringify(prePgState, null, 2), "utf-8");
  console.log(`Backed up live PostgreSQL Round ${prePgState.version} -> ${preBackupPath}`);

  // 2. Regenerate constrained draw enforcing Hamza Darawi -> Zeina Darawi alongside all existing rules
  const result = await regenerateFullDraw("127.0.0.1", "constrained");
  console.log(`Regenerate result: version=${result.version}, backup=${result.backupBlobKey}`);

  // 3. Re-read from PostgreSQL and verify all 56 participants, partitions, and constraints (without logging secret pairings)
  const postPgState = await getPostgresEventState();
  if (!postPgState) {
    throw new Error("Failed to read back post-migration state from PostgreSQL");
  }

  if (postPgState.participants.length !== 56) {
    throw new Error(`Expected 56 participants in PostgreSQL, got ${postPgState.participants.length}`);
  }
  if (postPgState.drawMode !== "constrained") {
    throw new Error(`Expected drawMode='constrained', got ${postPgState.drawMode}`);
  }

  const pairs: AssignmentPair[] = [];
  for (const p of postPgState.participants) {
    if (p.isRevealed || p.pinHash || p.passkeyCredentialId) {
      throw new Error(`Expected clean unrevealed/unlocked state for ${p.name}`);
    }
    const recName = decryptRecipient(p.encryptedRecipient!, p.code, postPgState.masterSalt);
    const recP = PARTICIPANTS.find((item) => item.name === recName);
    if (!recP) {
      throw new Error(`Decrypted unknown recipient '${recName}' for ${p.name}`);
    }
    pairs.push({
      giverId: p.id,
      giverName: p.name,
      recipientId: recP.id,
      recipientName: recP.name,
    });
  }

  const check = validateConstrainedSecretSantaDraw(PARTICIPANTS, pairs);
  if (!check.valid) {
    throw new Error(`Post-migration constraint validation failed: ${check.reason}`);
  }

  const devices = await sql`SELECT count(*)::int AS c FROM device_bindings`;
  const hwDevices = await sql`SELECT count(*)::int AS c FROM hardware_bindings`;
  const revealed = await sql`SELECT count(*)::int AS c FROM event_participants WHERE is_revealed = true`;

  console.log(
    JSON.stringify(
      {
        version: postPgState.version,
        drawMode: postPgState.drawMode,
        totalParticipants: postPgState.participants.length,
        subgroup24Count: SUBGROUP_20_IDS.length,
        remainingCount: postPgState.participants.length - SUBGROUP_20_IDS.length,
        crossBoundaryEdges: pairs.filter(
          (pair) => SUBGROUP_20_ID_SET.has(pair.giverId) !== SUBGROUP_20_ID_SET.has(pair.recipientId)
        ).length,
        preservedConstraints: {
          reciprocalGhazalGeorge:
            pairs.some((a) => a.giverName === MANDATORY_RECIPROCAL_A && a.recipientName === MANDATORY_RECIPROCAL_B) &&
            pairs.some((a) => a.giverName === MANDATORY_RECIPROCAL_B && a.recipientName === MANDATORY_RECIPROCAL_A),
          directedDianaMohammad: pairs.some(
            (a) => a.giverName === MANDATORY_DIRECTED_GIVER_2 && a.recipientName === MANDATORY_DIRECTED_RECIPIENT_2
          ),
          directedHamzaZeina: pairs.some(
            (a) => a.giverName === MANDATORY_DIRECTED_GIVER_3 && a.recipientName === MANDATORY_DIRECTED_RECIPIENT_3
          ),
          exclusionRaghadMohammad: !pairs.some(
            (a) =>
              (a.giverName === FORBIDDEN_EXCLUSION_C && a.recipientName === FORBIDDEN_EXCLUSION_D) ||
              (a.giverName === FORBIDDEN_EXCLUSION_D && a.recipientName === FORBIDDEN_EXCLUSION_C)
          ),
        },
        deviceBindingsCount: Number(devices[0]?.c ?? -1),
        hardwareBindingsCount: Number(hwDevices[0]?.c ?? -1),
        revealedCount: Number(revealed[0]?.c ?? -1),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("Reseed failed:", err);
  process.exit(1);
});
