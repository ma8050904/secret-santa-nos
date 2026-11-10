# 02 — WEBAUTHN FORENSIC AUDIT
## Credential Registration, Exclusion Behavior, and Authenticator Architecture

**Audit Target:** WebAuthn (Passkeys / Biometrics)  
**Files Audited:**
- `src/app/api/auth/biometric/options/route.ts`
- `src/app/api/auth/biometric/verify/route.ts`
- `src/lib/storage.ts`
- `src/components/PinAuthModal.tsx`

---

## 1. ENDPOINT & LIFECYCLE MAPPING

| Step | Endpoint / Method | Component / Function | Purpose | Authoritative Storage |
|---|---|---|---|---|
| **1. Options Generation** | `POST /api/auth/biometric/options` | `generateRegistrationOptions` / `generateAuthenticationOptions` | Auto-detects if participant already registered passkey; returns challenge and `excludeCredentials`. | Server-generated challenge stored in `santa_biometric_challenge` HTTP-only cookie (TTL: 300s). |
| **2. Client Ceremony** | Browser API | `navigator.credentials.create` / `navigator.credentials.get` | Invokes macOS Touch ID / iOS Face ID / Android BiometricPrompt via `@simplewebauthn/browser`. | Apple Secure Enclave / Android Keystore / TPM. |
| **3. Verification** | `POST /api/auth/biometric/verify` | `verifyRegistrationResponse` / `verifyAuthenticationResponse` | Validates authenticator attestation/assertion against stored challenge and origin. | `v7/participants/${id}.json`, `v7/passkeys/${id}`, `v7/all_passkey_credentials/${credId}`. |

---

## 2. FORENSIC ROOT-CAUSE ANALYSIS: "The string contains invalid characters"

### Incident Manifestation
In production, when a participant taps their name to authenticate, the UI immediately fails with the error message:
```text
The string contains invalid characters.
```
and automatically diverts the participant to the 4-digit PIN form without triggering Touch ID or Face ID.

### Forensic Tracing:
1. When `POST /api/auth/biometric/options` executes for a first-time registration, it calls `getAllRegisteredPasskeyCredentials()`.
2. `getAllRegisteredPasskeyCredentials()` queries `allRegisteredCredentialIdsSet`, `runtimeParticipantCache`, and `state.participants`.
3. In `@simplewebauthn/browser`, before sending options to the platform authenticator, the library transforms base64url strings into `Uint8Array` buffers:
   ```ts
   function base64URLStringToBuffer(base64URLString: string): ArrayBuffer {
     // Decodes base64url string
     const base64 = base64URLString.replace(/-/g, '+').replace(/_/g, '/');
     const padLen = (4 - (base64.length % 4)) % 4;
     return atob(base64 + '='.repeat(padLen));
   }
   ```
4. If **ANY single credential ID** in the `excludeCredentials` array contains characters that are NOT valid base64url (e.g. `"passkey_marker_present"`, raw text strings, or fallback error messages like `"Your store is blocked"`), the browser's native `window.atob()` function throws:
   ```text
   DOMException: Failed to execute 'atob' on 'Window': The string contains invalid characters.
   ```
5. `PinAuthModal.tsx` catches this `DOMException` in its `try/catch` block, sets `setError(err.message)`, and falls back to PIN entry.
6. **Classification:** `FAILED` (Format sanitization bug in `excludeCredentials`).

---

## 3. DEEP DIVE: `excludeCredentials` CAPABILITIES & LIMITATIONS

### A. Origin & Scoping
- **Source:** Server-side aggregation across all event participants via `getAllRegisteredPasskeyCredentials()`.
- **Scope:** Correctly bound to Relying Party ID (`rpID: "secret-santa-holiday.vercel.app"`).
- **Behavior:** According to W3C WebAuthn Level 2 / Level 3 specification:
  > If `publicKey.excludeCredentials` is present, the authenticator MUST return an `InvalidStateError` if any credential in the list is already present in this authenticator for this RP ID.

### B. What `excludeCredentials` CAN Prevent:
- It successfully prevents creating a second passkey for Participant B on the **exact same physical device**, using the **same browser engine**, across **Normal and Incognito tabs**, provided the credential ID is valid base64url.

### C. What `excludeCredentials` CANNOT Prevent:
1. **iCloud Keychain & Google Password Manager Synchronization:**
   - Passkeys created with `residentKey: "preferred"` or `authenticatorAttachment: "platform"` in iOS/macOS are synchronized via iCloud Keychain across all devices signed into the same Apple ID.
   - If User A creates a passkey on their iPhone, that passkey is automatically synced to their iPad and Mac.
   - User A can therefore open their account from 3 distinct physical devices.
   - Conversely, if two family members share an iCloud Family account or device, credential leakage across hardware occurs transparently.
2. **Multi-Browser Isolation on Desktops:**
   - On Windows or Linux, Chrome uses its own software keystore or Windows Hello. Firefox on Windows may maintain separate credentials. A user switching from Chrome to Firefox on Windows may not see excluded credentials from the other browser.
3. **Roaming Authenticators (YubiKeys / External Keys):**
   - The current code specifies `authenticatorAttachment: "platform"`. This excludes external USB/NFC security keys. If a user tries to use a YubiKey, registration is rejected by design.

---

## 4. CONCURRENCY & RACE CONDITIONS

### Registration Race Condition:
- If Participant A and Participant B attempt biometric registration simultaneously on two separate devices:
  - Both requests receive `options` before either has committed to `v7/all_passkey_credentials/`.
  - Both successfully register.
  - This is expected and correct for separate participants on separate devices.
- If an adversary attempts to register two participants on the same device concurrently in two tabs:
  - Tab 1 creates credential 1.
  - Tab 2 creates credential 2 before Tab 1's credential ID is written to the server's `excludeCredentials` list.
  - **Vulnerability:** Server-side `verifyRegistrationResponse` does not check if the authenticator's AAGUID or public key was already registered by another participant.
  - **Classification:** `SECURITY GAPS IDENTIFIED`.
