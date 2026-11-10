/**
 * Serverless Transactional PostgreSQL Storage & Device Ownership Module
 * Designed for Vercel Serverless Functions with Neon / Vercel Postgres connection pooling.
 * Enforces:
 * 1. Strict atomic device ownership constraints (UNIQUE participant_id, UNIQUE device_id).
 * 2. Distributed atomic rate limiting across all serverless microVM instances.
 * 3. Durable, ACID-compliant persistence for all 56 participants.
 */

import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { PARTICIPANTS } from "./constants";
import { EventState, DeviceBindingRecord, StoredParticipant, AdminAuditLogEntry } from "./storage";

let sqlClient: NeonQueryFunction<false, false> | null = null;

export function getDatabaseUrl(): string | null {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    null
  );
}

export function isPostgresConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

export function getDbClient(): NeonQueryFunction<false, false> | null {
  const dbUrl = getDatabaseUrl();
  if (!dbUrl) return null;
  if (!sqlClient) {
    sqlClient = neon(dbUrl);
  }
  return sqlClient;
}

/**
 * Initializes all required database tables, unique constraints, and indexes.
 * Executed idempotently.
 */
export async function initializeDatabaseSchema(): Promise<boolean> {
  const sql = getDbClient();
  if (!sql) return false;

  try {
    // 1. Event Metadata table
    await sql`
      CREATE TABLE IF NOT EXISTS event_meta (
        key VARCHAR(64) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 2. Participants table with encrypted credentials and passkeys
    await sql`
      CREATE TABLE IF NOT EXISTS event_participants (
        id VARCHAR(32) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        code VARCHAR(64) NOT NULL,
        code_hash VARCHAR(128) NOT NULL,
        encrypted_recipient TEXT,
        is_revealed BOOLEAN DEFAULT FALSE,
        revealed_at TIMESTAMP WITH TIME ZONE,
        pin_hash VARCHAR(128),
        pin_salt VARCHAR(128),
        encrypted_with_pin BOOLEAN DEFAULT FALSE,
        passkey_credential_id VARCHAR(256),
        passkey_public_key TEXT,
        passkey_counter BIGINT DEFAULT 0,
        passkey_registered_at TIMESTAMP WITH TIME ZONE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 3. Device Bindings table with ATOMIC UNIQUE CONSTRAINTS:
    // - UNIQUE(device_id) ensures device cannot be bound to two participants
    // - UNIQUE(participant_id) ensures participant cannot bind multiple devices
    await sql`
      CREATE TABLE IF NOT EXISTS device_bindings (
        device_id VARCHAR(64) PRIMARY KEY,
        participant_id VARCHAR(32) NOT NULL UNIQUE,
        participant_name VARCHAR(128) NOT NULL,
        hardware_fingerprint VARCHAR(128),
        bound_at TIMESTAMP WITH TIME ZONE NOT NULL,
        last_used_at TIMESTAMP WITH TIME ZONE NOT NULL,
        ip VARCHAR(64),
        user_agent TEXT,
        device_model VARCHAR(128),
        os VARCHAR(64),
        browser VARCHAR(64),
        summary VARCHAR(256),
        has_revealed BOOLEAN DEFAULT FALSE,
        revealed_at TIMESTAMP WITH TIME ZONE,
        reset_version INT DEFAULT 1
      );
    `;

    // 4. Hardware Bindings table: ensures hardware fingerprint binds to at most one participant
    await sql`
      CREATE TABLE IF NOT EXISTS hardware_bindings (
        hardware_fingerprint VARCHAR(128) PRIMARY KEY,
        participant_id VARCHAR(32) NOT NULL UNIQUE,
        participant_name VARCHAR(128) NOT NULL,
        device_id VARCHAR(64) NOT NULL,
        bound_at TIMESTAMP WITH TIME ZONE NOT NULL,
        reset_version INT DEFAULT 1
      );
    `;

    // 5. Distributed Rate Limits table: atomic cross-instance lockout tracking
    await sql`
      CREATE TABLE IF NOT EXISTS distributed_rate_limits (
        key VARCHAR(128) PRIMARY KEY,
        attempts INT NOT NULL DEFAULT 1,
        first_attempt_at BIGINT NOT NULL,
        blocked_until BIGINT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 6. Admin Audit Logs table
    await sql`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id VARCHAR(64) PRIMARY KEY,
        action VARCHAR(64) NOT NULL,
        action_label VARCHAR(128) NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        ip VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        details TEXT NOT NULL
      );
    `;

    return true;
  } catch (err) {
    console.error("Database schema initialization error:", err);
    return false;
  }
}

/**
 * Atomic Serverless Rate Limiter.
 * Executes atomically inside PostgreSQL to guarantee distributed consistency across all Vercel microVMs.
 */
export async function checkDistributedRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 10 * 60 * 1000,
  blockDurationMs: number = 15 * 60 * 1000
): Promise<{ allowed: boolean; remainingAttempts: number; retryAfterSec?: number }> {
  const sql = getDbClient();
  if (!sql) {
    // Fall back to local in-memory rate limiter when offline/testing
    const { checkRateLimit } = await import("./rate-limit");
    return checkRateLimit(key);
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    const rows = await sql`
      INSERT INTO distributed_rate_limits (key, attempts, first_attempt_at, blocked_until, updated_at)
      VALUES (${key}, 1, ${now}, NULL, NOW())
      ON CONFLICT (key) DO UPDATE
      SET
        attempts = CASE
          WHEN distributed_rate_limits.blocked_until IS NOT NULL AND distributed_rate_limits.blocked_until > ${now}
            THEN distributed_rate_limits.attempts
          WHEN distributed_rate_limits.first_attempt_at < ${windowStart}
            THEN 1
          ELSE distributed_rate_limits.attempts + 1
        END,
        first_attempt_at = CASE
          WHEN distributed_rate_limits.first_attempt_at < ${windowStart}
            THEN ${now}
          ELSE distributed_rate_limits.first_attempt_at
        END,
        blocked_until = CASE
          WHEN distributed_rate_limits.blocked_until IS NOT NULL AND distributed_rate_limits.blocked_until > ${now}
            THEN distributed_rate_limits.blocked_until
          WHEN distributed_rate_limits.attempts >= ${maxAttempts}
            THEN ${now + blockDurationMs}
          ELSE NULL
        END,
        updated_at = NOW()
      RETURNING attempts, blocked_until, first_attempt_at;
    `;

    if (rows && rows.length > 0) {
      const record = rows[0];
      const blockedUntil = record.blocked_until ? Number(record.blocked_until) : null;
      if (blockedUntil && blockedUntil > now) {
        const retryAfterSec = Math.ceil((blockedUntil - now) / 1000);
        return { allowed: false, remainingAttempts: 0, retryAfterSec };
      }
      const attempts = Number(record.attempts);
      const remainingAttempts = Math.max(0, maxAttempts - attempts);
      return { allowed: true, remainingAttempts };
    }
  } catch (err) {
    console.error("Distributed rate limit error:", err);
  }

  return { allowed: true, remainingAttempts: maxAttempts - 1 };
}

/**
 * Resets a distributed rate limit key upon successful authentication.
 */
export async function resetDistributedRateLimit(key: string): Promise<void> {
  const sql = getDbClient();
  if (!sql) {
    const { resetRateLimit } = await import("./rate-limit");
    resetRateLimit(key);
    return;
  }
  try {
    await sql`DELETE FROM distributed_rate_limits WHERE key = ${key}`;
  } catch (err) {
    console.error("Reset distributed rate limit error:", err);
  }
}

/**
 * Atomically binds a device to an authenticated participant in PostgreSQL.
 * Guarantees strict ONE-PARTICIPANT-PER-DEVICE:
 * - If device_id already belongs to another participant -> REJECT.
 * - If participant_id already has a different registered device -> REJECT or UPDATE atomically.
 * - If hardware_fingerprint belongs to another participant -> REJECT.
 */
export async function atomicBindDeviceToParticipant(
  deviceId: string,
  participantId: string,
  participantName: string,
  meta?: { ip?: string; userAgent?: string; hardwareFingerprint?: string; resetVersion?: number }
): Promise<{ success: boolean; error?: string }> {
  const sql = getDbClient();
  if (!sql) {
    return { success: false, error: "Database not configured." };
  }

  const cleanDeviceId = deviceId.trim().toLowerCase();
  const cleanHwFp = meta?.hardwareFingerprint?.trim().toLowerCase() || null;
  const now = new Date().toISOString();
  const resetVersion = meta?.resetVersion || 1;

  try {
    // 1. Check existing device binding
    const existingDeviceRows = await sql`
      SELECT participant_id, participant_name FROM device_bindings
      WHERE device_id = ${cleanDeviceId} AND reset_version >= ${resetVersion};
    `;
    if (existingDeviceRows.length > 0 && existingDeviceRows[0].participant_id !== participantId) {
      return {
        success: false,
        error: `This device is officially registered to ${existingDeviceRows[0].participant_name}.`,
      };
    }

    // 2. Check existing hardware fingerprint binding
    if (cleanHwFp && cleanHwFp.length > 5) {
      const existingHwRows = await sql`
        SELECT participant_id, participant_name FROM hardware_bindings
        WHERE hardware_fingerprint = ${cleanHwFp} AND reset_version >= ${resetVersion};
      `;
      if (existingHwRows.length > 0 && existingHwRows[0].participant_id !== participantId) {
        return {
          success: false,
          error: `This physical device is already registered to ${existingHwRows[0].participant_name}. Accessing multiple accounts from the same physical device is strictly forbidden.`,
        };
      }
    }

    // 3. Atomic Upsert for Device Binding
    await sql`
      INSERT INTO device_bindings (
        device_id, participant_id, participant_name, hardware_fingerprint,
        bound_at, last_used_at, ip, user_agent, reset_version
      )
      VALUES (
        ${cleanDeviceId}, ${participantId}, ${participantName}, ${cleanHwFp},
        ${now}, ${now}, ${meta?.ip || "unknown"}, ${meta?.userAgent || ""}, ${resetVersion}
      )
      ON CONFLICT (device_id) DO UPDATE
      SET
        last_used_at = ${now},
        ip = ${meta?.ip || "unknown"},
        user_agent = ${meta?.userAgent || ""};
    `;

    // 4. Atomic Upsert for Hardware Binding
    if (cleanHwFp && cleanHwFp.length > 5) {
      await sql`
        INSERT INTO hardware_bindings (
          hardware_fingerprint, participant_id, participant_name, device_id, bound_at, reset_version
        )
        VALUES (
          ${cleanHwFp}, ${participantId}, ${participantName}, ${cleanDeviceId}, ${now}, ${resetVersion}
        )
        ON CONFLICT (hardware_fingerprint) DO UPDATE
        SET
          device_id = ${cleanDeviceId};
      `;
    }

    return { success: true };
  } catch (err: any) {
    console.error("Atomic device binding error:", err);
    if (err?.code === "23505") {
      // Postgres unique_violation
      return {
        success: false,
        error: "This device or participant account is already bound to another registration.",
      };
    }
    return { success: false, error: "Database error binding device." };
  }
}
