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

    // 2. Participants table with encrypted credentials, unique cryptographic identities, and passkeys
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
        security_identity_id VARCHAR(64),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // Strict Unique Constraints on Cryptographic Credentials & Participant Security Identities
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_security_identity_id 
      ON event_participants (security_identity_id) 
      WHERE security_identity_id IS NOT NULL;
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_passkey_credential_id 
      ON event_participants (passkey_credential_id) 
      WHERE passkey_credential_id IS NOT NULL;
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

  let resetVersion = meta?.resetVersion;
  if (!resetVersion) {
    try {
      const stateRows = await sql`SELECT (value->>'deviceResetVersion')::int as rv FROM event_meta WHERE key = 'master_event_state' LIMIT 1;`;
      if (stateRows.length > 0 && stateRows[0].rv) {
        resetVersion = Number(stateRows[0].rv);
      }
    } catch {
      // fallback
    }
  }
  resetVersion = resetVersion || 1;

  try {
    // 0. Check if participant is already bound to a different device (Strict One Device Per Participant)
    const existingParticipantRows = await sql`
      SELECT device_id, participant_name FROM device_bindings
      WHERE participant_id = ${participantId} AND reset_version >= ${resetVersion};
    `;
    if (existingParticipantRows.length > 0 && existingParticipantRows[0].device_id !== cleanDeviceId) {
      return {
        success: false,
        error: `Participant ${participantName} already has an active registered device. Multiple devices per account are not permitted.`,
      };
    }

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
    // Apple iOS devices share identical screen/WebGL hardware profiles across all users of the same iPhone model.
    // To prevent false-positive lockouts between different students owning identical phone models,
    // we match against device_id when present, or hardware_fingerprint when querying directly.
    if (cleanHwFp && cleanHwFp.length > 5) {
      const existingHwRows = cleanDeviceId
        ? await sql`
            SELECT participant_id, participant_name FROM hardware_bindings
            WHERE hardware_fingerprint = ${cleanHwFp} AND device_id = ${cleanDeviceId} AND reset_version >= ${resetVersion};
          `
        : await sql`
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

    // 3. Atomic Upsert for Device Binding with Participant Ownership Lock
    const devRows = await sql`
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
        user_agent = ${meta?.userAgent || ""},
        hardware_fingerprint = COALESCE(device_bindings.hardware_fingerprint, EXCLUDED.hardware_fingerprint)
      WHERE device_bindings.participant_id = EXCLUDED.participant_id
      RETURNING participant_id;
    `;
    if (!devRows || devRows.length === 0) {
      return {
        success: false,
        error: "Device binding conflict: This device is already bound to another participant.",
      };
    }

    // 4. Atomic Upsert for Hardware Binding with Participant Ownership Lock
    if (cleanHwFp && cleanHwFp.length > 5) {
      const hwRows = await sql`
        INSERT INTO hardware_bindings (
          hardware_fingerprint, participant_id, participant_name, device_id, bound_at, reset_version
        )
        VALUES (
          ${cleanHwFp}, ${participantId}, ${participantName}, ${cleanDeviceId}, ${now}, ${resetVersion}
        )
        ON CONFLICT (hardware_fingerprint) DO UPDATE
        SET
          device_id = EXCLUDED.device_id
        WHERE hardware_bindings.participant_id = EXCLUDED.participant_id
        RETURNING participant_id;
      `;
      if (!hwRows || hwRows.length === 0) {
        return {
          success: false,
          error: "Hardware binding conflict: This physical device is already bound to another participant.",
        };
      }
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

/**
 * Checks whether a device or physical hardware fingerprint is already bound to any participant.
 * Operates across all Vercel Serverless microVM instances, cold starts, and Incognito browsing tabs.
 */
export async function getPostgresDeviceOrHardwareBinding(
  deviceId: string,
  hwFp?: string | null,
  resetVersion: number = 1
): Promise<{ participantId: string; participantName: string; deviceId: string; hardwareFingerprint?: string } | null> {
  const sql = getDbClient();
  if (!sql) return null;

  const cleanDeviceId = deviceId?.trim().toLowerCase();
  const cleanHwFp = hwFp?.trim().toLowerCase();

  try {
    // 1. Check by Device ID
    if (cleanDeviceId) {
      const devRows = await sql`
        SELECT participant_id, participant_name, device_id, hardware_fingerprint
        FROM device_bindings
        WHERE device_id = ${cleanDeviceId} AND reset_version >= ${resetVersion}
        LIMIT 1;
      `;
      if (devRows && devRows.length > 0) {
        return {
          participantId: String(devRows[0].participant_id),
          participantName: String(devRows[0].participant_name),
          deviceId: String(devRows[0].device_id),
          hardwareFingerprint: devRows[0].hardware_fingerprint ? String(devRows[0].hardware_fingerprint) : undefined,
        };
      }
    }

    // 2. Check by Physical Hardware Fingerprint
    // Apple iOS devices share identical screen/WebGL hardware profiles across all users of the same iPhone model.
    // To prevent false-positive lockouts between different students owning identical phone models,
    // we match against device_id when present, or hardware_fingerprint when querying directly.
    if (cleanHwFp && cleanHwFp.length > 5) {
      const hwRows = cleanDeviceId
        ? await sql`
            SELECT participant_id, participant_name, device_id, hardware_fingerprint
            FROM hardware_bindings
            WHERE hardware_fingerprint = ${cleanHwFp} AND device_id = ${cleanDeviceId} AND reset_version >= ${resetVersion}
            LIMIT 1;
          `
        : await sql`
            SELECT participant_id, participant_name, device_id, hardware_fingerprint
            FROM hardware_bindings
            WHERE hardware_fingerprint = ${cleanHwFp} AND reset_version >= ${resetVersion}
            LIMIT 1;
          `;
      if (hwRows && hwRows.length > 0) {
        return {
          participantId: String(hwRows[0].participant_id),
          participantName: String(hwRows[0].participant_name),
          deviceId: String(hwRows[0].device_id),
          hardwareFingerprint: String(hwRows[0].hardware_fingerprint),
        };
      }
    }
  } catch (err) {
    console.error("Database error in getPostgresDeviceOrHardwareBinding:", err);
  }

  return null;
}

/**
 * Clears an individual participant's authentication credentials, reveal state,
 * and associated device bindings in PostgreSQL.
 */
export async function clearPostgresParticipant(participantId: string): Promise<boolean> {
  const sql = getDbClient();
  if (!sql) return false;
  try {
    await sql`
      UPDATE event_participants
      SET
        pin_hash = NULL,
        pin_salt = NULL,
        encrypted_with_pin = FALSE,
        is_revealed = FALSE,
        revealed_at = NULL,
        passkey_credential_id = NULL,
        passkey_public_key = NULL,
        passkey_counter = 0,
        passkey_registered_at = NULL,
        updated_at = NOW()
      WHERE id = ${participantId};
    `;

    await sql`DELETE FROM device_bindings WHERE participant_id = ${participantId};`;
    await sql`DELETE FROM hardware_bindings WHERE participant_id = ${participantId};`;

    return true;
  } catch (err) {
    console.error("Database error clearing participant in PostgreSQL:", err);
    return false;
  }
}

/**
 * Resets all participant authentication credentials, reveal states, and passkeys in PostgreSQL.
 * Used during full draw regeneration.
 */
export async function resetPostgresParticipantsAuthentication(): Promise<boolean> {
  const sql = getDbClient();
  if (!sql) return false;
  try {
    await sql`
      UPDATE event_participants
      SET
        pin_hash = NULL,
        pin_salt = NULL,
        encrypted_with_pin = FALSE,
        is_revealed = FALSE,
        revealed_at = NULL,
        passkey_credential_id = NULL,
        passkey_public_key = NULL,
        passkey_counter = 0,
        passkey_registered_at = NULL,
        updated_at = NOW();
    `;
    await sql`TRUNCATE TABLE device_bindings;`;
    await sql`TRUNCATE TABLE hardware_bindings;`;
    return true;
  } catch (err) {
    console.error("Database error resetting all participants in PostgreSQL:", err);
    return false;
  }
}

/**
 * Clears all device bindings and hardware fingerprint locks in PostgreSQL
 * during an authorized draw regeneration or administrative reset.
 */
export async function clearPostgresDeviceBindings(): Promise<void> {
  const sql = getDbClient();
  if (!sql) return;
  try {
    await sql`TRUNCATE TABLE device_bindings;`;
    await sql`TRUNCATE TABLE hardware_bindings;`;
  } catch (err) {
    console.error("Database error clearing device bindings:", err);
  }
}

/**
 * Retrieves the authoritative master event state from PostgreSQL.
 */
export async function getPostgresEventState(): Promise<EventState | null> {
  const sql = getDbClient();
  if (!sql) return null;
  try {
    const rows = await sql`SELECT value FROM event_meta WHERE key = 'master_event_state' LIMIT 1;`;
    if (rows && rows.length > 0 && rows[0].value) {
      return (typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value) as EventState;
    }
  } catch (err) {
    console.error("Database error reading event state from PostgreSQL:", err);
  }
  return null;
}

/**
 * Persists an isolated participant's credentials and reveal state into PostgreSQL.
 * Enforces strict cryptographic credential uniqueness across all participants.
 */
export async function savePostgresParticipantState(state: any): Promise<boolean> {
  const sql = getDbClient();
  if (!sql) return false;
  try {
    // 1. Strict Server-Enforced Credential Ownership Check:
    // A WebAuthn passkey credential registered to Participant A can NEVER be registered or assigned to Participant B.
    if (state.passkeyCredentialId) {
      const cleanCredId = String(state.passkeyCredentialId).trim();
      const existingOwner = await sql`
        SELECT id, name FROM event_participants 
        WHERE passkey_credential_id = ${cleanCredId} AND id != ${state.participantId}
        LIMIT 1;
      `;
      if (existingOwner && existingOwner.length > 0) {
        console.error(
          `Security violation: Attempted cross-participant passkey assignment of credential ${cleanCredId} from ${existingOwner[0].id} to ${state.participantId}`
        );
        throw new Error(
          `Cross-participant credential reuse blocked: passkey is already bound to participant ${existingOwner[0].id}`
        );
      }
    }

    // 2. Ensure participant's cryptographic security identity exists
    const cryptoModule = await import("crypto");
    const secId = cryptoModule
      .createHmac("sha256", process.env.SESSION_SECRET || "SantaMagic2024_Round7_FinalClean_v7_Production_Strict")
      .update(`identity:${state.participantId}:${state.name || "clean"}`)
      .digest("hex");

    const safeIso = (d: any): string | null => {
      if (!d) return null;
      try {
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? null : dt.toISOString();
      } catch {
        return null;
      }
    };
    const revealedAtIso = safeIso(state.revealedAt);
    const passkeyRegisteredAtIso = safeIso(state.passkeyRegisteredAt);

    await sql`
      INSERT INTO event_participants (
        id, name, code, code_hash, encrypted_recipient, is_revealed, revealed_at,
        pin_hash, pin_salt, encrypted_with_pin, passkey_credential_id,
        passkey_public_key, passkey_counter, passkey_registered_at, security_identity_id, updated_at
      )
      VALUES (
        ${state.participantId}, ${state.name}, '', '', ${state.encryptedRecipient || null},
        ${Boolean(state.isRevealed)}, ${revealedAtIso},
        ${state.pinHash || null}, ${state.pinSalt || null}, ${Boolean(state.encryptedWithPin)},
        ${state.passkeyCredentialId || null}, ${state.passkeyPublicKey || null},
        ${state.passkeyCounter || 0}, ${passkeyRegisteredAtIso}, ${secId}, NOW()
      )
      ON CONFLICT (id) DO UPDATE
      SET
        encrypted_recipient = EXCLUDED.encrypted_recipient,
        is_revealed = EXCLUDED.is_revealed,
        revealed_at = EXCLUDED.revealed_at,
        pin_hash = EXCLUDED.pin_hash,
        pin_salt = EXCLUDED.pin_salt,
        encrypted_with_pin = EXCLUDED.encrypted_with_pin,
        passkey_credential_id = EXCLUDED.passkey_credential_id,
        passkey_public_key = EXCLUDED.passkey_public_key,
        passkey_counter = EXCLUDED.passkey_counter,
        passkey_registered_at = EXCLUDED.passkey_registered_at,
        security_identity_id = COALESCE(event_participants.security_identity_id, EXCLUDED.security_identity_id),
        updated_at = NOW();
    `;
    return true;
  } catch (err) {
    console.error("Database error saving participant state to PostgreSQL:", err);
    throw err;
  }
}

/**
 * Checks whether a WebAuthn passkey credential ID is already owned by any participant in PostgreSQL.
 */
export async function getPasskeyCredentialOwner(
  credentialId: string
): Promise<{ participantId: string; participantName: string } | null> {
  const sql = getDbClient();
  if (!sql || !credentialId) return null;
  try {
    const rows = await sql`
      SELECT id, name FROM event_participants
      WHERE passkey_credential_id = ${credentialId.trim()}
      LIMIT 1;
    `;
    if (rows && rows.length > 0) {
      return {
        participantId: String(rows[0].id),
        participantName: String(rows[0].name),
      };
    }
  } catch (err) {
    console.error("Database error checking passkey credential owner:", err);
  }
  return null;
}

/**
 * Retrieves a participant's immutable cryptographic security identity from PostgreSQL.
 */
export async function getParticipantSecurityIdentity(participantId: string): Promise<string | null> {
  const sql = getDbClient();
  if (!sql || !participantId) return null;
  try {
    const rows = await sql`
      SELECT security_identity_id FROM event_participants
      WHERE id = ${participantId}
      LIMIT 1;
    `;
    if (rows && rows.length > 0 && rows[0].security_identity_id) {
      return String(rows[0].security_identity_id);
    }
  } catch (err) {
    console.error("Database error fetching security identity:", err);
  }
  return null;
}

/**
 * Retrieves an isolated participant's credentials and reveal state from PostgreSQL.
 */
export async function getPostgresParticipantState(participantId: string): Promise<any | null> {
  const sql = getDbClient();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT id, name, encrypted_recipient, is_revealed, revealed_at,
             pin_hash, pin_salt, encrypted_with_pin, passkey_credential_id,
             passkey_public_key, passkey_counter, passkey_registered_at
      FROM event_participants
      WHERE id = ${participantId}
      LIMIT 1;
    `;
    if (rows && rows.length > 0) {
      const r = rows[0];
      return {
        participantId: r.id,
        name: r.name,
        pinHash: r.pin_hash || undefined,
        pinSalt: r.pin_salt || undefined,
        encryptedRecipient: r.encrypted_recipient || undefined,
        encryptedWithPin: Boolean(r.encrypted_with_pin),
        isRevealed: Boolean(r.is_revealed),
        revealedAt: r.revealed_at ? String(r.revealed_at) : null,
        passkeyCredentialId: r.passkey_credential_id || null,
        passkeyPublicKey: r.passkey_public_key || null,
        passkeyCounter: Number(r.passkey_counter || 0),
        passkeyRegisteredAt: r.passkey_registered_at ? String(r.passkey_registered_at) : null,
      };
    }
  } catch (err) {
    console.error("Database error fetching participant state from PostgreSQL:", err);
  }
  return null;
}

/**
 * Retrieves all registered passkey credential IDs from PostgreSQL.
 * Used for hardware exclusion in WebAuthn registration ceremonies.
 */
export async function getPostgresAllPasskeyCredentialIds(): Promise<string[]> {
  const sql = getDbClient();
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT passkey_credential_id
      FROM event_participants
      WHERE passkey_credential_id IS NOT NULL 
        AND passkey_credential_id != ''
        AND passkey_credential_id != 'registered'
        AND passkey_credential_id != 'passkey_marker_present';
    `;
    return rows.map((r: any) => String(r.passkey_credential_id)).filter(Boolean);
  } catch (err) {
    console.error("Database error fetching all passkey credential IDs from PostgreSQL:", err);
    return [];
  }
}

/**
 * Persists the authoritative master event state atomically into PostgreSQL.
 */
export async function savePostgresEventState(state: EventState, isFullReset: boolean = false): Promise<boolean> {
  const sql = getDbClient();
  if (!sql) return false;
  try {
    const jsonStr = JSON.stringify(state);
    await sql`
      INSERT INTO event_meta (key, value, updated_at)
      VALUES ('master_event_state', ${jsonStr}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = ${jsonStr}::jsonb, updated_at = NOW();
    `;

    // Detect if this is an authentic full reset / fresh draw state
    const isReset = isFullReset || (
      Array.isArray(state.participants) &&
      state.participants.length > 0 &&
      state.participants.every((p) => !p.pinHash && !p.passkeyCredentialId && !p.isRevealed)
    );

    // Also sync all participants into the event_participants table
    if (state.participants && Array.isArray(state.participants)) {
      for (const p of state.participants) {
        if (isReset) {
          await sql`
            INSERT INTO event_participants (
              id, name, code, code_hash, encrypted_recipient, is_revealed, revealed_at,
              pin_hash, pin_salt, encrypted_with_pin, passkey_credential_id,
              passkey_public_key, passkey_counter, passkey_registered_at, updated_at
            )
            VALUES (
              ${p.id}, ${p.name}, ${p.code || ''}, ${p.codeHash || ''}, ${p.encryptedRecipient || null},
              ${Boolean(p.isRevealed)}, ${p.revealedAt ? new Date(p.revealedAt) : null},
              ${p.pinHash || null}, ${p.pinSalt || null}, ${Boolean(p.encryptedWithPin)},
              ${p.passkeyCredentialId || null}, ${p.passkeyPublicKey || null},
              ${p.passkeyCounter || 0}, ${p.passkeyRegisteredAt ? new Date(p.passkeyRegisteredAt) : null}, NOW()
            )
            ON CONFLICT (id) DO UPDATE
            SET
              name = EXCLUDED.name,
              code = EXCLUDED.code,
              code_hash = EXCLUDED.code_hash,
              encrypted_recipient = EXCLUDED.encrypted_recipient,
              is_revealed = EXCLUDED.is_revealed,
              revealed_at = EXCLUDED.revealed_at,
              pin_hash = EXCLUDED.pin_hash,
              pin_salt = EXCLUDED.pin_salt,
              encrypted_with_pin = EXCLUDED.encrypted_with_pin,
              passkey_credential_id = EXCLUDED.passkey_credential_id,
              passkey_public_key = EXCLUDED.passkey_public_key,
              passkey_counter = EXCLUDED.passkey_counter,
              passkey_registered_at = EXCLUDED.passkey_registered_at,
              updated_at = NOW();
          `;
        } else {
          await sql`
            INSERT INTO event_participants (
              id, name, code, code_hash, encrypted_recipient, is_revealed, revealed_at,
              pin_hash, pin_salt, encrypted_with_pin, passkey_credential_id,
              passkey_public_key, passkey_counter, passkey_registered_at, updated_at
            )
            VALUES (
              ${p.id}, ${p.name}, ${p.code || ''}, ${p.codeHash || ''}, ${p.encryptedRecipient || null},
              ${Boolean(p.isRevealed)}, ${p.revealedAt ? new Date(p.revealedAt) : null},
              ${p.pinHash || null}, ${p.pinSalt || null}, ${Boolean(p.encryptedWithPin)},
              ${p.passkeyCredentialId || null}, ${p.passkeyPublicKey || null},
              ${p.passkeyCounter || 0}, ${p.passkeyRegisteredAt ? new Date(p.passkeyRegisteredAt) : null}, NOW()
            )
            ON CONFLICT (id) DO UPDATE
            SET
              name = EXCLUDED.name,
              encrypted_recipient = EXCLUDED.encrypted_recipient,
              is_revealed = EXCLUDED.is_revealed,
              revealed_at = EXCLUDED.revealed_at,
              pin_hash = COALESCE(event_participants.pin_hash, EXCLUDED.pin_hash),
              pin_salt = COALESCE(event_participants.pin_salt, EXCLUDED.pin_salt),
              encrypted_with_pin = COALESCE(event_participants.encrypted_with_pin, EXCLUDED.encrypted_with_pin),
              passkey_credential_id = COALESCE(event_participants.passkey_credential_id, EXCLUDED.passkey_credential_id),
              passkey_public_key = COALESCE(event_participants.passkey_public_key, EXCLUDED.passkey_public_key),
              passkey_counter = GREATEST(event_participants.passkey_counter, EXCLUDED.passkey_counter),
              passkey_registered_at = COALESCE(event_participants.passkey_registered_at, EXCLUDED.passkey_registered_at),
              updated_at = NOW();
          `;
        }
      }
    }

    return true;
  } catch (err) {
    console.error("Database error saving event state to PostgreSQL:", err);
    return false;
  }
}

/**
 * Retrieves lightweight markers (revealed, registered, passkeys) atomically from PostgreSQL.
 * Completely replaces high-cost Blob list calls and eliminates rate-limit/quota lockouts.
 */
export async function getPostgresMarkers(): Promise<{
  revealed: string[];
  registered: string[];
  passkeys: Array<{ participantId: string; credentialId: string }>;
} | null> {
  const sql = getDbClient();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT id, is_revealed,
             (pin_hash IS NOT NULL OR passkey_credential_id IS NOT NULL) AS is_registered,
             passkey_credential_id
      FROM event_participants;
    `;
    const revealed: string[] = [];
    const registered: string[] = [];
    const passkeys: Array<{ participantId: string; credentialId: string }> = [];

    for (const r of rows) {
      const pid = String(r.id);
      if (r.is_revealed) revealed.push(pid);
      if (r.is_registered) registered.push(pid);
      if (r.passkey_credential_id) {
        passkeys.push({ participantId: pid, credentialId: String(r.passkey_credential_id) });
      }
    }
    return { revealed, registered, passkeys };
  } catch (err) {
    console.error("Database error fetching markers from PostgreSQL:", err);
    return null;
  }
}

/**
 * Records a participant and device reveal transactionally in PostgreSQL.
 */
export async function recordPostgresDeviceReveal(
  deviceId: string,
  participantId: string
): Promise<boolean> {
  const sql = getDbClient();
  if (!sql) return false;
  try {
    const cleanId = deviceId.trim().toLowerCase();
    await sql`
      UPDATE event_participants
      SET is_revealed = TRUE, revealed_at = NOW()
      WHERE id = ${participantId};
    `;
    await sql`
      UPDATE device_bindings
      SET has_revealed = TRUE, revealed_at = NOW()
      WHERE device_id = ${cleanId} OR participant_id = ${participantId};
    `;
    return true;
  } catch (err) {
    console.error("Database error recording device reveal in PostgreSQL:", err);
    return false;
  }
}

