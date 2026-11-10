# WebAuthn Security, atob() Exception Root Cause & Counter Specification
## Secret Santa Platform — M5 Security Directive

---

## 1. Forensic Root Cause of "The string contains invalid characters"

### The User-Reported Symptom
When a participant tapped their name on the mobile browser:
1. The modal opened, but the native Face ID / Touch ID biometric prompt **never appeared**.
2. The UI immediately switched to the "4-Digit PIN" tab.
3. A red error banner displayed: `The string contains invalid characters.`

### Technical Root Cause
The error was a client-side `DOMException: The string contains invalid characters.` thrown by `@simplewebauthn/browser` during `startRegistration({ optionsJSON })`.

1. **How SimpleWebAuthn Decodes Options**:
   When `@simplewebauthn/browser` receives `optionsJSON.excludeCredentials`, it iterates over every credential ID and converts it from Base64URL string to an `ArrayBuffer` using `base64URLStringToBuffer(cred.id)`.
   Inside `base64URLStringToBuffer`, it performs:
   ```javascript
   const base64 = base64URLString.replace(/-/g, '+').replace(/_/g, '/');
   const padLen = (4 - (base64.length % 4)) % 4;
   return Uint8Array.from(atob(base64.padEnd(base64.length + padLen, '=')), c => c.charCodeAt(0)).buffer;
   ```
2. **Where the Invalid String Came From**:
   Prior to remediation, `getAllRegisteredPasskeyCredentials()` collected marker strings such as `"passkey_marker_present"` or filenames directly from the store without validating that they conformed to Base64URL encoding.
   Because `"passkey_marker_present"` or malformed credential strings contained invalid characters for Base64 decoding, `window.atob(...)` threw:
   `DOMException: The string contains invalid characters.`
3. **Premature Ceremony Failure**:
   Because the exception occurred synchronously during options decoding **before** `navigator.credentials.create()` was called, the platform biometric dialog was never invoked.
   The exception was caught in `PinAuthModal.tsx`, which set `activeTab = "pin"` and rendered `err.message` (`"The string contains invalid characters."`) into the error banner.

---

## 2. Multi-Layer Remediation & Defense-in-Depth

### Layer 1: Strict Credential ID Validation (`isValidPasskeyCredentialId`)
Defined in `src/lib/storage.ts`:
```typescript
export function isValidPasskeyCredentialId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (
    trimmed === "passkey_marker_present" ||
    trimmed === "registered" ||
    trimmed === "true" ||
    trimmed.includes(" ")
  ) {
    return false;
  }
  return /^[A-Za-z0-9_-]{16,}$/.test(trimmed);
}
```
Enforced across:
- `getAllRegisteredPasskeyCredentials()`: Quarantines any invalid or legacy marker strings.
- `getParticipantBiometricStatus()`: Guarantees only validated Base64URL credential IDs are returned.
- `/api/auth/biometric/options`: Ensures `excludeCredentials` contains only validated Base64URL IDs.
- `/api/auth/biometric/verify`: Rejects any incoming registration credential not meeting this strict specification.

### Layer 2: Client-Side Defensive Filter in `PinAuthModal.tsx`
Before invoking `@simplewebauthn/browser`, both `excludeCredentials` and `allowCredentials` are pre-sanitized in memory:
```typescript
if (optData.mode === "register" && optData.options?.excludeCredentials) {
  optData.options.excludeCredentials = optData.options.excludeCredentials.filter(
    (c: any) => c && typeof c.id === "string" && isValidPasskeyCredentialId(c.id)
  );
}
```

---

## 3. WebAuthn Anti-Replay Counter Tracking

To prevent signature replay attacks:
1. During authentication verification in `/api/auth/biometric/verify`:
   ```typescript
   const verification = await verifyAuthenticationResponse({
     response: clientResponse,
     expectedChallenge,
     expectedOrigin: origin,
     expectedRPID: rpID,
     credential: {
       id: status.passkeyCredentialId,
       publicKey: Buffer.from(status.passkeyPublicKey, "base64url"),
       counter: status.passkeyCounter ?? 0,
     },
     requireUserVerification: true,
   });
   ```
2. When the authenticator responds with an incremented counter (`newCounter`), the updated counter is persisted in storage via `authenticateParticipantBiometric(participantId, newCounter)`.
3. If an attacker replays a previously captured authentication payload with a counter $\le$ stored counter, `verifyAuthenticationResponse` rejects it.

---

## 4. RP ID & Origin Whitelisting (Anti-Host Injection)

In `src/lib/admin-auth.ts`:
`getWebAuthnRpDetails` validates incoming Host headers against an explicit domain allowlist:
- `secret-santa-holiday.vercel.app` (Production)
- `*.vercel.app` (Preview deployments)
- `localhost` / `127.0.0.1` (Development)
Any unrecognized or spoofed Host header safely defaults to `secret-santa-holiday.vercel.app` and `https://secret-santa-holiday.vercel.app`.

---

## 5. Platform Authenticator Capabilities

WebAuthn platform authenticators vary by device:
- **Apple Devices (iOS / macOS)**: Face ID / Touch ID backed by the Apple Secure Enclave.
- **Android Devices**: Fingerprint / Face Unlock backed by Android KeyStore / StrongBox TPM.
- **Windows Devices**: Windows Hello backed by discrete or firmware TPM 2.0.
The system supports all compliant W3C WebAuthn platform authenticators without making false hardware claims.
