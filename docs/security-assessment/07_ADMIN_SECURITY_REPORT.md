# 07 — Administrative Security & Privilege Escalation Assessment

**Target:** `https://secret-santa-holiday.vercel.app` & Local Environment  
**Module:** Administrative Control Plane (`/admin`, `/api/admin/*`)  
**Evaluator:** M5 Autonomous Engineering System (Red Team & Blue Team)  
**Execution Timestamp:** 2026-11-11T04:20:00Z  
**Verdict:** **VERIFIED SECURE**

---

## 1. Executive Summary

The Administrative Control Plane governs sensitive event lifecycle operations:
- Full draw regeneration (`/api/admin/regenerate-full-draw`)
- Individual participant credential & binding resets (`/api/admin/participants/reset`)
- Draw mode configuration (`/api/admin/set-draw-mode`)
- Biometric passkey registration & revocation (`/api/admin/passkey/*`)
- Audit log tracking (`/api/admin/audit-logs`)
- Master password updates (`/api/admin/change-password`)

A comprehensive red team evaluation was conducted to probe for broken access control, privilege escalation, credential bypass, and zero-knowledge data leakage. All endpoints enforce strict authentication guards via HMAC-SHA256 session tokens or salted scrypt password hashing.

---

## 2. Attack Simulation & Test Evidence

### Test ATK-ADM-01: Unauthorized Administrative Operation
- **Attack Scenario:** Direct unauthenticated `POST` request to `/api/admin/regenerate-full-draw` without cookies or headers.
- **Preconditions:** Server running with active event state.
- **Payload:** `POST /api/admin/regenerate-full-draw` with empty headers.
- **Expected Behavior:** Immediate `401 Unauthorized` rejection; no state changes.
- **Actual Behavior:** Server responded with HTTP `401 Unauthorized` (`{ success: false, error: "Unauthorized" }`). Event state was untouched.
- **Evidence Reference:** Verified in `test/m5-full-penetration-test.ts` (Test ATK-ADM-01).
- **Result:** **PASS (VERIFIED)**.

---

### Test ATK-ADM-02: Forged Admin Session Cookie
- **Attack Scenario:** Attacker creates an altered or forged `santa_admin_token` cookie (e.g. modifying role, timestamp, or altering signature bytes).
- **Preconditions:** Secret key known only to server runtime (`ADMIN_SESSION_SECRET`).
- **Payload:** `santa_admin_token=adm.YWRtaW46MTc5NDM0MDAwMDphYmNk.forged_signature_123`
- **Expected Behavior:** Server validates HMAC-SHA256 in constant time (`crypto.timingSafeEqual`) and rejects invalid tokens.
- **Actual Behavior:** `verifyAdminSessionToken` evaluated to `false`; request rejected with HTTP `401 Unauthorized`.
- **Evidence Reference:** `src/lib/admin-auth.ts:66-90`.
- **Result:** **PASS (VERIFIED)**.

---

### Test ATK-ADM-03: Zero-Knowledge Privacy Enforcement (`getAdminSafeState`)
- **Attack Scenario:** Malicious administrator or compromised admin session attempts to extract recipient assignments or plaintext participant PINs from administrative status APIs.
- **Preconditions:** Master draw generated with 56 active assignments and registered PINs.
- **Endpoint Inspected:** `getAdminSafeState()` (`src/lib/storage.ts`).
- **Expected Behavior:** Plaintext PINs, PIN hashes, PIN salts, and `encryptedRecipient` fields must be completely stripped from the response object.
- **Actual Behavior:** Inspection confirmed:
  - `pinHash` omitted.
  - `pinSalt` omitted.
  - `encryptedRecipient` omitted.
  - `recipientName` / `recipientId` omitted.
  - Only non-sensitive metrics returned: `id`, `name`, `isRevealed`, `revealedAt`, `isRegistered`, and device metadata summary.
- **Evidence Reference:** Verified in `test/m5-full-penetration-test.ts` (Test ATK-ADM-03).
- **Result:** **PASS (VERIFIED)**.

---

### Test ATK-ADM-04: Single Participant Atomic Reset
- **Attack Scenario:** Admin resets an individual participant whose device was lost or locked, without wiping other participants or causing desynchronization between PostgreSQL and state files.
- **Preconditions:** Participant registered with active PIN, WebAuthn passkey, and device binding in PostgreSQL.
- **Execution:** Admin invokes `resetSingleParticipant(participantId)` via `/api/admin/participants/reset`.
- **Expected Behavior:** Participant credentials and bindings wiped in Neon PostgreSQL (`event_participants`, `device_bindings`, `hardware_bindings`). Remaining 55 participants remain completely intact.
- **Actual Behavior:** PostgreSQL atomic queries executed:
  ```sql
  UPDATE event_participants SET pin_hash=NULL, pin_salt=NULL, passkey_credential_id=NULL WHERE id = $1;
  DELETE FROM device_bindings WHERE participant_id = $1;
  DELETE FROM hardware_bindings WHERE participant_id = $1;
  ```
  Verified that targeted participant became unregistered while adjacent participants retained full credential integrity.
- **Evidence Reference:** Verified in `test/m5-full-penetration-test.ts` (Test ATK-ADM-04).
- **Result:** **PASS (VERIFIED)**.

---

## 3. Privilege Escalation Defenses

1. **Defense Against Header Injection:**
   Administrative requests validate `x-admin-password` against scrypt-hashed credentials stored in `event_meta`, with constant-time string comparison (`secureCompare`) preventing timing attacks.
2. **Session Cookie Isolation:**
   Admin cookies (`santa_admin_token`) carry `HttpOnly`, `SameSite=Lax`, and `Secure` attributes in production, preventing JavaScript access and CSRF exploitation.
3. **No Standalone Device Unbinding Endpoint:**
   To prevent rogue bypass of device binding rules, there is no generic client endpoint allowing arbitrary device unbinding without full administrative authentication.
