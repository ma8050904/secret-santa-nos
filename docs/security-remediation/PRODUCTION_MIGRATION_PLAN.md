# M5 Security Remediation — Production Migration Plan
**Project:** `secret-santa-christmas`  
**Target:** 56 Participants | Round 0 Active Draw  
**Execution Gate:** STOP BEFORE DEPLOYMENT — Awaiting Human Authorization  
**Policy:** Zero Data Loss | Zero Draw Regeneration | Backward-Compatible

---

## 1. Migration Overview

To resolve the persistent Vercel Blob store suspension (HTTP 403 Forbidden) and the serverless local disk concurrency limitation, the application requires migrating to a managed transactional PostgreSQL datastore (such as Neon Serverless Postgres).

This migration must be executed with **zero disruption** to the existing 56 participant assignments, preserving all custom pairings and previous registration progress.

---

## 2. PostgreSQL Relational Schema (DDL)

```sql
-- 1. Master Event State
CREATE TABLE event_state (
  id VARCHAR(64) PRIMARY KEY,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 0,
  device_reset_version INTEGER NOT NULL DEFAULT 1,
  master_salt VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Participants & Cryptographic Assignments
CREATE TABLE participants (
  id VARCHAR(64) PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL REFERENCES event_state(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(128) NOT NULL,
  group_type VARCHAR(64) NOT NULL DEFAULT 'standard',
  encrypted_recipient TEXT NOT NULL,
  encrypted_with_pin BOOLEAN NOT NULL DEFAULT FALSE,
  is_revealed BOOLEAN NOT NULL DEFAULT FALSE,
  revealed_at TIMESTAMPTZ,
  registered_at TIMESTAMPTZ,
  pin_hash VARCHAR(255),
  pin_salt VARCHAR(128),
  passkey_credential_id VARCHAR(255) UNIQUE,
  passkey_public_key TEXT,
  passkey_counter BIGINT DEFAULT 0,
  passkey_registered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Device & Hardware Bindings (One-Device-One-Participant Enforced by Unique Index)
CREATE TABLE device_bindings (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR(255) NOT NULL UNIQUE,
  hardware_fingerprint VARCHAR(255),
  participant_id VARCHAR(64) NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  participant_name VARCHAR(255) NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip VARCHAR(64),
  user_agent TEXT,
  device_model VARCHAR(128),
  os VARCHAR(64),
  browser VARCHAR(64),
  summary VARCHAR(255),
  has_revealed BOOLEAN NOT NULL DEFAULT FALSE,
  revealed_at TIMESTAMPTZ,
  reset_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_device_hw_fp ON device_bindings(hardware_fingerprint);
CREATE INDEX idx_device_participant ON device_bindings(participant_id);

-- 4. Distributed Rate Limiting Table
CREATE TABLE rate_limits (
  key VARCHAR(255) PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1,
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ
);

-- 5. Audit Log (Organizer-Safe, Zero Privacy Leak)
CREATE TABLE audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  action VARCHAR(64) NOT NULL,
  action_label VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  details TEXT,
  ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. Migration Procedure (Step-by-Step)

### Phase 1: Pre-Flight Verification & Snapshot
1. Verify existing backup: `.data/backup_verification_m5_remediation.json` (56 participants, all hashes intact).
2. Compute cryptographic SHA-256 checksum of the backup file to guarantee zero tampering:
   ```bash
   shasum -a 256 .data/backup_verification_m5_remediation.json
   ```

### Phase 2: Datastore Provisioning
1. Provision a Serverless PostgreSQL database (Neon / Vercel Postgres).
2. Execute the DDL schema above.
3. Verify connection pooling (`?sslmode=require&pool_timeout=10`).

### Phase 3: Data Ingestion (One-Time ETL)
1. Run isolated migration script `scripts/migrate-to-postgres.ts`:
   - Ingest master `event_state` (Round 0, masterSalt).
   - Ingest all 56 `participants` records along with their exact `encryptedRecipient` ciphertexts.
   - For participants who established PINs or passkeys, preserve their `pinHash`, `pinSalt`, and validated `passkeyCredentialId`.
   - Ingest existing `device_bindings`.
2. Execute post-ingestion verification query:
   ```sql
   SELECT COUNT(*) AS total_participants, 
          COUNT(encrypted_recipient) AS with_recipient,
          COUNT(DISTINCT name) AS unique_names
   FROM participants;
   -- Must return: 56, 56, 56
   ```

### Phase 4: Production Environment Configuration
1. Update Vercel Project Environment Variables:
   - Add `DATABASE_URL` (connection-pooled URL).
   - Verify `SANTA_ADMIN_KEY` matches current secret.
2. Deploy the updated application build containing the remediated WebAuthn regex sanitization, watchdog timers, and PostgreSQL adapter.

### Phase 5: Live Smoke Test
1. Access production URL with an authorized test account.
2. Verify Face ID / Touch ID prompts without throwing DOMException.
3. Verify gift unwrapping animation transitions smoothly within 450ms.
4. Verify admin dashboard displays 56 participants without exposing recipient mappings.

---

## 6. Deployment Authorization Gate

**STATUS: PAUSED BEFORE DEPLOYMENT.**  
No code or database changes have been applied to production. Execution is halted awaiting explicit user confirmation and deployment authorization.
