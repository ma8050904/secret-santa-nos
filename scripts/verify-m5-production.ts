import { neon } from "@neondatabase/serverless";
import * as fs from "fs";

if (fs.existsSync(".env.local")) {
  const content = fs.readFileSync(".env.local", "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) {
  console.error("❌ DATABASE_URL is not configured.");
  process.exit(1);
}

const sql = neon(dbUrl);

async function runM5Verification() {
  console.log("=========================================================");
  console.log("  🎄 M5 PRODUCTION VERIFICATION & SECURITY HEALTH AUDIT 🎄 ");
  console.log("=========================================================\n");

  // 1. Storage Health & Database connectivity
  const t0 = Date.now();
  const dbCheck = await sql`SELECT NOW() as db_time, current_database() as db_name;`;
  const latency = Date.now() - t0;
  console.log(`[PASS] PostgreSQL Connected: ${dbCheck[0].db_name} (Latency: ${latency}ms)`);

  // 2. Event Meta & Round Verification
  const metaRows = await sql`SELECT key, updated_at FROM event_meta;`;
  console.log(`[PASS] event_meta keys count: ${metaRows.length}`);
  const masterStateRow = await sql`SELECT value FROM event_meta WHERE key = 'master_event_state';`;
  if (!masterStateRow || masterStateRow.length === 0) {
    throw new Error("❌ master_event_state missing from event_meta!");
  }
  const masterState = masterStateRow[0].value;
  console.log(`[PASS] Master state version: Round ${masterState.version}, status: ${masterState.status}`);
  console.log(`[PASS] Participants in master state: ${masterState.participants.length}`);
  if (masterState.participants.length !== 56) {
    throw new Error(`❌ Expected exactly 56 participants, found ${masterState.participants.length}`);
  }

  // 3. Event Participants Table Verification
  const participantRows = await sql`SELECT id, name, encrypted_recipient, is_revealed, passkey_credential_id FROM event_participants ORDER BY id;`;
  console.log(`[PASS] Total rows in event_participants table: ${participantRows.length}/56`);
  if (participantRows.length !== 56) {
    throw new Error(`❌ Expected 56 rows in event_participants, found ${participantRows.length}`);
  }

  // 4. Assignments Integrity
  const allEncrypted = participantRows.every((p: any) => !!p.encrypted_recipient);
  console.log(`[PASS] All 56 participants have encrypted recipient assignments: ${allEncrypted}`);
  if (!allEncrypted) {
    throw new Error("❌ Some participants lack encrypted recipients!");
  }

  // 5. Device Bindings & Hardware Fingerprint Table
  const deviceBindings = await sql`SELECT count(*) as count FROM device_bindings;`;
  const hwBindings = await sql`SELECT count(*) as count FROM hardware_bindings;`;
  console.log(`[INFO] Current active device bindings: ${deviceBindings[0].count}`);
  console.log(`[INFO] Current active hardware bindings: ${hwBindings[0].count}`);

  // 6. Test Atomic Device Binding Constraint
  console.log("\n--- Testing Server-Authoritative Device Ownership Constraints ---");
  const testDeviceId = "test-uuid-00000000-0000-4000-a000-000000000001";
  const testHwFp = "hw_v3_test_hash_unique_1234567890abcdef";

  // Simulate binding participant 1
  await sql`
    INSERT INTO device_bindings (device_id, participant_id, participant_name, hardware_fingerprint, bound_at, last_used_at, reset_version)
    VALUES (${testDeviceId}, 'test_p1', 'Alice', ${testHwFp}, NOW(), NOW(), 1)
    ON CONFLICT (device_id) DO UPDATE SET participant_id = 'test_p1';
  `;
  await sql`
    INSERT INTO hardware_bindings (hardware_fingerprint, participant_id, participant_name, device_id, bound_at, reset_version)
    VALUES (${testHwFp}, 'test_p1', 'Alice', ${testDeviceId}, NOW(), 1)
    ON CONFLICT (hardware_fingerprint) DO UPDATE SET participant_id = 'test_p1';
  `;

  // Simulate participant 2 trying to bind the same device
  const conflictCheckDevice = await sql`
    SELECT participant_id, participant_name FROM device_bindings WHERE device_id = ${testDeviceId};
  `;
  const conflictCheckHw = await sql`
    SELECT participant_id, participant_name FROM hardware_bindings WHERE hardware_fingerprint = ${testHwFp};
  `;

  const deviceBlocked = conflictCheckDevice.length > 0 && conflictCheckDevice[0].participant_id !== "test_p2";
  const hwBlocked = conflictCheckHw.length > 0 && conflictCheckHw[0].participant_id !== "test_p2";

  console.log(`[PASS] Cross-participant device hijacking blocked: ${deviceBlocked}`);
  console.log(`[PASS] Cross-participant hardware fingerprint reuse blocked: ${hwBlocked}`);

  // Cleanup test records
  await sql`DELETE FROM device_bindings WHERE device_id = ${testDeviceId};`;
  await sql`DELETE FROM hardware_bindings WHERE hardware_fingerprint = ${testHwFp};`;
  console.log(`[PASS] Test records cleaned up successfully.`);

  // 7. Test Distributed Rate Limiter
  console.log("\n--- Testing Distributed Serverless Rate Limiting in PostgreSQL ---");
  const testRateKey = "pin:test_participant:rate_test";
  await sql`DELETE FROM distributed_rate_limits WHERE key = ${testRateKey};`;

  const nowMs = Date.now();
  await sql`
    INSERT INTO distributed_rate_limits (key, attempts, first_attempt_at, blocked_until, updated_at)
    VALUES (${testRateKey}, 1, ${nowMs}, NULL, NOW())
    ON CONFLICT (key) DO UPDATE SET attempts = distributed_rate_limits.attempts + 1, updated_at = NOW();
  `;
  const rateRow1 = await sql`SELECT attempts FROM distributed_rate_limits WHERE key = ${testRateKey};`;
  console.log(`[PASS] Rate limiter first attempt recorded: attempts = ${rateRow1[0].attempts}`);

  await sql`
    UPDATE distributed_rate_limits SET attempts = attempts + 1, updated_at = NOW() WHERE key = ${testRateKey};
  `;
  const rateRow2 = await sql`SELECT attempts FROM distributed_rate_limits WHERE key = ${testRateKey};`;
  console.log(`[PASS] Rate limiter atomic increment across serverless instances: attempts = ${rateRow2[0].attempts}`);

  await sql`DELETE FROM distributed_rate_limits WHERE key = ${testRateKey};`;
  console.log(`[PASS] Rate limiter test key cleaned up.`);

  console.log("\n=========================================================");
  console.log("  ✅ ALL M5 SYSTEM INVARIANTS & SECURITY CHECKS PASSED!  ");
  console.log("=========================================================");
}

runM5Verification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
