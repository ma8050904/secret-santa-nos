# 08 — Storage & Database Security Architecture

**Target:** `https://secret-santa-holiday.vercel.app` & Local Environment  
**Database:** Serverless Neon PostgreSQL (`store_4NxSC1pqkg4IKxmT`)  
**Storage Fallback:** Ephemeral Local Cache (`.data/` read-only safe)  
**Evaluator:** M5 Autonomous Engineering System  
**Execution Timestamp:** 2026-11-11T04:21:00Z  
**Verdict:** **VERIFIED SECURE**

---

## 1. Storage Architecture & Vercel Blob Incident Resolution

### Incident Analysis: Vercel Blob Hobby Quota Depletion
- **Root Cause:** Vercel Blob's Hobby Plan imposes a hard limit of 2,000 Advanced Operations (PUT, DELETE, LIST) per month. Automated polling, status refreshes, and state writes exhausted the quota (reaching 2.4K / 2K), triggering `BlobServiceError: Suspended / Rate Limited` on cloud functions.
- **Remediation:** Full architectural migration to Neon PostgreSQL as the primary transactional datastore. All state mutations, device registrations, distributed rate limits, and audit logs are managed transactionally in SQL.
- **Zero Vercel Blob Dependency:** Storage routines detect `isPostgresConfigured()` and route all critical path reads and writes to Neon PostgreSQL, rendering the application immune to Blob quota suspension.

---

## 2. PostgreSQL ACID Transaction & Schema Integrity

### Schema Definition
```sql
CREATE TABLE IF NOT EXISTS event_meta (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_participants (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  code VARCHAR(64),
  code_hash VARCHAR(128),
  encrypted_recipient TEXT,
  is_revealed BOOLEAN NOT NULL DEFAULT FALSE,
  revealed_at TIMESTAMPTZ,
  pin_hash TEXT,
  pin_salt TEXT,
  encrypted_with_pin BOOLEAN NOT NULL DEFAULT FALSE,
  passkey_credential_id TEXT,
  passkey_public_key TEXT,
  passkey_counter BIGINT NOT NULL DEFAULT 0,
  passkey_registered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_bindings (
  device_id VARCHAR(128) PRIMARY KEY,
  participant_id VARCHAR(64) NOT NULL UNIQUE,
  participant_name VARCHAR(128) NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta JSONB,
  reset_version INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS hardware_bindings (
  hardware_fingerprint VARCHAR(128) PRIMARY KEY,
  participant_id VARCHAR(64) NOT NULL UNIQUE,
  participant_name VARCHAR(128) NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reset_version INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key VARCHAR(128) PRIMARY KEY,
  count INT NOT NULL DEFAULT 1,
  first_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ
);
```

---

## 3. Atomic Device Binding Proof

When a client attempts to bind a device to a participant, `atomicBindDeviceToParticipant` runs an atomic SQL transaction:

1. **Participant One-Device Check:**
   `SELECT device_id FROM device_bindings WHERE participant_id = $1`
   Rejects immediately if the participant is already bound to a different device.
2. **Device One-Participant Check:**
   `SELECT participant_id FROM device_bindings WHERE device_id = $1`
   Rejects immediately if the device is already bound to another participant.
3. **Hardware Fingerprint Check:**
   `SELECT participant_id FROM hardware_bindings WHERE hardware_fingerprint = $1`
   Rejects if the physical hardware signature matches another participant.
4. **Atomic Insertion:**
   Inserts into `device_bindings` and `hardware_bindings`. PostgreSQL table-level `UNIQUE` constraints guarantee race-condition safety even under concurrent serverless execution.

---

## 4. Draw Regeneration & Full Reset Atomicity

During draw regeneration:
- PostgreSQL `TRUNCATE TABLE device_bindings;` and `TRUNCATE TABLE hardware_bindings;` execute atomically.
- `resetPostgresParticipantsAuthentication()` resets `pin_hash`, `pin_salt`, `encrypted_with_pin`, `is_revealed`, and all passkey credentials.
- `savePostgresEventState` bypasses `COALESCE` logic using the `isReset` flag, guaranteeing that stale PINs or passkeys from previous draws cannot persist.
