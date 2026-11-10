# M5 Security Remediation — Architecture Decisions Record (ADR)
**Project:** `secret-santa-christmas`  
**Target:** 56 Participants | Round 0 Active Draw  
**Governance:** M5 Engineering Policy — Authentic Astra Directives

---

## 1. ADR-01: Rejection of Local Disk for Production Serverless Storage

### Context
In serverless platforms such as Vercel, functions execute in ephemeral, isolated microVM containers. Files written to local disk (such as `.data/secret-santa-event.json` or `/tmp/`) are:
1. Local to the specific container instance and not shared across concurrent instances.
2. Discarded as soon as the execution container spins down or is recycled.
3. Incapable of providing ACID transactional semantics across distributed requests (e.g. concurrent registrations, distributed rate limits, or device binding uniqueness).

### Decision
**Local disk storage (`.data/`) is strictly rejected as the authoritative production persistence layer.**  
For local development, integration testing, and CI pipelines, local disk storage remains supported via the `STORAGE_FILE_PATH` environment variable.

### Production Solution: External Transactional Datastore (PostgreSQL / Neon)
To guarantee consistency for 56 concurrent participants without race conditions:
- **Engine:** PostgreSQL (Serverless connection pooled via Neon or AWS Aurora Serverless).
- **Relational Integrity:**
  - `UNIQUE (participant_id)` on participant credentials and assignments.
  - `UNIQUE (device_id)` and `UNIQUE (hardware_fingerprint)` on device bindings to enforce **One Device → One Participant** at the database schema level.
- **Concurrency Control:** Atomic transactions (`BEGIN ... COMMIT`) with row-level locks (`SELECT ... FOR UPDATE`) to prevent simultaneous double-registration or assignment overwrite.
- **Distributed Rate Limiting:** Persistent sliding-window rate limiting stored in PostgreSQL or Redis rather than ephemeral in-memory maps.

---

## 2. ADR-02: Preservation of Automatic Device Fingerprinting

### Context
User requirement: **One Physical Device → One Participant**. The application must attempt to identify the same device automatically across normal browsing, incognito/private browsing, different browser profiles, and after clearing cookies.

### Decision
**Automatic device fingerprinting (`src/lib/fingerprint.ts`) is preserved, versioned, and normalized.**
Signals collected:
1. **Canvas 2D Rendering:** Subpixel font hinting, antialiasing artifacts, composite blending.
2. **WebGL Rendering:** GPU vendor, unmasked renderer string, texture size, extension capabilities.
3. **AudioContext DSP:** DynamicsCompressor frequency response and floating-point audio buffer sum.
4. **Hardware & Environment Metrics:** Screen dimensions, color depth, pixel ratio, hardware concurrency, touch points, platform, and timezone.

### Architectural Reality & Security Boundary
- **Probabilistic Heuristic, Not Cryptographic Proof:** Browser-level fingerprinting calculates a client-side SHA-256 hash (`hw_v2_<hash>`). While it successfully recognizes identical physical hardware between normal and incognito tabs in standard browsers (Chrome, Safari, Edge), it cannot cryptographically attest hardware identity.
- **Adversarial Forgery:** Direct API requests via curl or scripts can spoof the `x-hardware-fingerprint` HTTP header.
- **Privacy Browsers:** Browsers with built-in canvas randomization (Brave Shields, Firefox RFP) generate randomized signatures per session.
- **Role in Defense-in-Depth:** Device fingerprinting serves as an automatic detection layer for honest/ordinary participants. For strict hardware-level locking, it is paired with WebAuthn `excludeCredentials` and server-side device binding.

---

## 3. ADR-03: WebAuthn Silicon-Level Hardware Exclusion

### Context
WebAuthn platform authenticators (Apple Secure Enclave, Android StrongBox/TEE, Windows Hello TPM) are tied to physical hardware. By passing `excludeCredentials` during registration, the authenticator hardware itself enforces that a second credential cannot be registered on the same device.

### Decision
1. **Zero Placeholder Policy:**
   Placeholder strings (such as `"passkey_marker_present"`) are permanently forbidden.
2. **Strict Base64URL Sanitization:**
   Only credential IDs matching `/^[A-Za-z0-9_-]{16,}$/` are admitted to `allowCredentials` and `excludeCredentials`.
3. **Quarantine Strategy:**
   Any credential record that fails validation is quarantined immediately and treated as `hasPasskey: false`, allowing the participant to perform a clean, authenticated registration.

---

## 4. ADR-04: Distributed Rate Limiting Architecture

### Context
In-memory `rateLimitMap` in `src/lib/rate-limit.ts` is reset on every serverless cold start and is not shared across lambda instances. An attacker could rotate requests across serverless instances to bypass the 5-attempt PIN lockout.

### Decision
1. In the target PostgreSQL migration, rate limits will be tracked in a dedicated `rate_limits` table:
   ```sql
   CREATE TABLE rate_limits (
     key VARCHAR(255) PRIMARY KEY,
     attempts INTEGER NOT NULL DEFAULT 1,
     first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     locked_until TIMESTAMPTZ
   );
   ```
2. Atomically updated via `INSERT ... ON CONFLICT (key) DO UPDATE`.
3. Evaluates sliding window across all serverless instances globally.
