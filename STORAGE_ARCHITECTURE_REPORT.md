# Hybrid Storage Architecture & Data Tier Report

**Target Project:** `secret-santa-christmas`  
**Transactional Engine:** Neon Serverless PostgreSQL (`store_4NxSC1pqkg4IKxmT`)  
**Object Store:** Vercel Private Blob (`santa-storage`)  
**Evaluator:** M5 Autonomous Engineering Authority  
**Execution Timestamp:** 2026-11-11T05:09:00Z  

---

## 1. Storage Tier Separation & Responsibilities

The application enforces a strict architectural boundary between **transactional state** and **object storage**:

```
+---------------------------------------------------------------------------------+
|                                APPLICATION CORE                                 |
+---------------------------------------------------------------------------------+
          |                                                               |
          | [Transactional Operations]                                    | [Object Storage]
          v                                                               v
+--------------------------------------+            +-----------------------------+
|          Neon PostgreSQL             |            |      Vercel Private Blob    |
| (Authoritative Master Datastore)     |            |       (santa-storage)       |
+--------------------------------------+            +-----------------------------+
| • Participant Credentials & PINs     |            | • Immutable Draw Backups    |
| • WebAuthn Public Keys & Counters    |            | • Event State Snapshots     |
| • Atomic Device & Hardware Bindings  |            | • Static Asset Caching      |
| • Distributed Rate Limiting          |            |                             |
| • Administrative Audit Logs          |            |                             |
| • ACID Transaction Guarantees        |            |                             |
+--------------------------------------+            +-----------------------------+
```

---

## 2. Neon PostgreSQL Role (Authoritative Master)

1. **Atomic Device Ownership:**
   Enforced via SQL unique indexes on `device_id` and `hardware_fingerprint` with conditional update clauses (`WHERE participant_id = EXCLUDED.participant_id`). Eliminates double-ownership and concurrency races.
2. **Distributed Rate Limiting:**
   Tracks failed authentication attempts atomically across all Vercel microVM instances inside `distributed_rate_limits`, preventing brute-force enumeration regardless of container recycling.
3. **Participant Registration & Reveal States:**
   Changes to `pin_hash`, `pin_salt`, `is_revealed`, and `passkey_counter` commit transactionally to `event_participants`.
4. **No Local Disk Fallback:**
   In production, any failure in PostgreSQL throws a fatal `ProductionDatabaseReadFailure` / `ProductionDatabaseWriteFailure`. Local disk (`.data/`) is never treated as a durable database.

---

## 3. Vercel Blob Role (Auxiliary Object Storage)

1. **Backup Snapshots:**
   Captures immutable timestamped snapshots of master state for Disaster Recovery (DR).
2. **Safe Isolation from Critical Path:**
   If Vercel Blob operations are exhausted or throttled, active participant logins, PIN validations, device checks, and reveals continue operating uninterrupted via Neon PostgreSQL.
