# Storage Incident Analysis & PostgreSQL Serverless Architecture
## Secret Santa Platform — M5 Security Directive

---

## 1. Executive Summary & Incident Root Cause

During the initial deployment of the Secret Santa platform on Vercel Serverless Functions, device binding and participant authentication exhibited synchronization inconsistencies across simultaneous sessions and Incognito windows.

### Primary Storage Failure Mechanisms

1. **Vercel Blob Storage Limitations**:
   - Vercel Blob is an immutable/append-only object store designed for static assets, not an ACID-compliant transactional relational database.
   - It lacks **atomic uniqueness constraints** (e.g., `UNIQUE(device_id)`, `UNIQUE(participant_id)`). Two concurrent requests hitting separate serverless microVMs could both read an unassigned state and concurrently overwrite the same blob key.
   - Eventual consistency and network propagation delays across distributed CDN edge regions caused race windows where a freshly registered device was not instantly visible to other edge nodes.

2. **Serverless Filesystem Ephemerality (`/tmp`)**:
   - Vercel Serverless Functions spin up isolated, ephemeral AWS Lambda / Firecracker microVM instances.
   - Local disk writes (`/tmp` or `.data/`) exist solely for the lifetime of that specific container instance and are **never shared** between concurrent instances.
   - An in-memory JavaScript `Map` or local directory lock in Instance A is completely invisible to Instance B, allowing parallel Incognito requests landing on different instances to circumvent local state checks.

---

## 2. PostgreSQL Serverless Architecture (`src/lib/db.ts`)

To provide zero-trust device binding and distributed concurrency control, a transactional PostgreSQL engine powered by `@neondatabase/serverless` was architected.

### Database Schema

```sql
-- 1. Participants Master Table
CREATE TABLE IF NOT EXISTS participants (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  pin_hash VARCHAR(128),
  pin_salt VARCHAR(64),
  passkey_credential_id VARCHAR(512),
  passkey_public_key TEXT,
  passkey_counter INT DEFAULT 0,
  has_registered BOOLEAN DEFAULT FALSE,
  is_revealed BOOLEAN DEFAULT FALSE,
  recipient_id VARCHAR(32),
  recipient_name VARCHAR(128),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Device Bindings: Enforces ONE-DEVICE-ONE-PARTICIPANT with atomic unique constraints
CREATE TABLE IF NOT EXISTS device_bindings (
  device_id VARCHAR(64) PRIMARY KEY,
  participant_id VARCHAR(32) NOT NULL UNIQUE,
  participant_name VARCHAR(128) NOT NULL,
  bound_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ip VARCHAR(64),
  hardware_fingerprint VARCHAR(128) UNIQUE,
  device_model VARCHAR(128),
  os VARCHAR(64),
  browser VARCHAR(64),
  summary VARCHAR(256),
  has_revealed BOOLEAN DEFAULT FALSE,
  revealed_at TIMESTAMP WITH TIME ZONE,
  reset_version INT DEFAULT 1
);

-- 3. Hardware Bindings: Enforces hardware fingerprint uniqueness across browsers/incognito
CREATE TABLE IF NOT EXISTS hardware_bindings (
  hardware_fingerprint VARCHAR(128) PRIMARY KEY,
  participant_id VARCHAR(32) NOT NULL UNIQUE,
  participant_name VARCHAR(128) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  bound_at TIMESTAMP WITH TIME ZONE NOT NULL,
  reset_version INT DEFAULT 1
);

-- 4. Distributed Rate Limits: Atomic cross-instance lockout tracking
CREATE TABLE IF NOT EXISTS distributed_rate_limits (
  key VARCHAR(128) PRIMARY KEY,
  attempts INT NOT NULL DEFAULT 1,
  first_attempt_at BIGINT NOT NULL,
  blocked_until BIGINT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Atomic Device Binding Logic

```typescript
// Single round-trip atomic insertion with constraint verification
export async function atomicBindDeviceToParticipant(
  deviceId: string,
  participantId: string,
  participantName: string,
  metadata?: DeviceMetadata
): Promise<{ success: boolean; conflictWith?: string }>
```

- If `device_id` already belongs to another participant -> **REJECTED** immediately.
- If `hardware_fingerprint` already belongs to another participant -> **REJECTED** immediately (detects Incognito / cache wipes).
- If `participant_id` is already bound to a different device -> **REJECTED** immediately.

### Distributed Atomic Rate Limiter

Using PostgreSQL's `INSERT ... ON CONFLICT (key) DO UPDATE`:
- Tracks failed PIN and biometric attempts atomically across all Vercel microVM instances.
- Automatically triggers a 15-minute lockout upon 5 consecutive failed attempts.
- Automatically resets upon successful authentication.
