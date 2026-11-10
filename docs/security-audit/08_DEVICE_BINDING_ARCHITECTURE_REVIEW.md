# 08 — DEVICE BINDING ARCHITECTURE REVIEW
## Technical Feasibility Analysis: Can "One Physical Device = One Participant" Be Guaranteed on the Web?

**Policy Objective:** Strictly enforce that one physical hardware unit can never register, unlock, or reveal more than one participant under any circumstances.  
**Execution Context:** Modern Web Browsers (Safari, Chrome, Firefox, Edge).

---

## 1. THE WEB PLATFORM'S ARCHITECTURAL REALITY

### Why Browsers Deliberately Hide Physical Hardware:
Under W3C standards and privacy regulations (GDPR, CCPA), modern browsers are sandboxed and **explicitly prohibit websites from accessing physical hardware identifiers**:
- No MAC addresses.
- No IMEI numbers.
- No CPU or Motherboard serial numbers.
- No Apple UDID.

Any browser-based attempt to reconstruct a physical device identifier relies on **heuristics** (Canvas, WebGL, AudioContext, screen resolution). While these heuristics are sophisticated, they are inherently:
1. **Client-controlled:** The client executes the code and can lie about the result.
2. **Non-unique across identical hardware:** Two identical iPhone 15 Pro units running iOS 18 on the same carrier display identical Canvas renders, WebGL extensions, and AudioContext compressor curves.

---

## 2. HIERARCHY OF IDENTITY ON THE WEB

```
┌────────────────────────────────────────────────────────┐
│ 1. Browser Storage Identity (Cookies / LocalStorage)   │ -> Trivially wiped by Incognito
├────────────────────────────────────────────────────────┤
│ 2. Browser Engine Fingerprint (Canvas, WebGL, Audio)   │ -> Stable across Incognito; spoofable via API
├────────────────────────────────────────────────────────┤
│ 3. WebAuthn Passkey (Secure Enclave / TPM)             │ -> Hardware-backed; synced via iCloud Keychain
├────────────────────────────────────────────────────────┤
│ 4. Native App Hardware Attestation (DeviceCheck/AppAttest)│ -> Cryptographically unforgeable (Native only)
└────────────────────────────────────────────────────────┘
```

---

## 3. PASSKEY SYNCHRONIZATION: THE DUAL-EDGED SWORD

WebAuthn platform authenticators (Face ID, Touch ID, Windows Hello) are the most secure authentication mechanism available in web browsers. 

However, modern passkeys are **designed by Apple and Google to sync**:
- A passkey registered on an iPhone automatically syncs via end-to-end encrypted iCloud Keychain to the user's MacBook and iPad.
- This provides seamless user experience, but directly contradicts the strict rule: "One physical device = One participant".
- If the participant logs into their MacBook, they can authenticate using the synced Touch ID credential.

---

## 4. REALISTIC, HIGH-ASSURANCE ARCHITECTURAL RECOMMENDATIONS

To achieve the strongest possible security within web standards without native mobile apps:

1. **Server-Side Tokenized Device Enrollment (Enrollment Codes):**
   - Each participant is assigned a single-use cryptographically signed QR code / enrollment link (e.g. `https://secret-santa-holiday.vercel.app/register?token=...`).
   - The token can be redeemed exactly once.
   - Upon redemption, the device establishes both a passkey and an authoritative session.
2. **Distributed Redis Locks (Upstash):**
   - Store device bindings and rate limits in a centralized, low-latency Redis database rather than in-memory maps or Vercel Blob.
   - Ensures sub-millisecond atomic checks across all distributed Vercel serverless functions.
3. **Strict WebAuthn Sanity Filter:**
   - Filter and sanitize all credential IDs before populating `excludeCredentials` to prevent browser crashes (`DOMException: The string contains invalid characters`).
4. **Administrative Device Oversight:**
   - Provide organizers with real-time visibility in the Organizer Dashboard, allowing them to see which device model and IP are attached to each participant, and single-click reset capability if a participant replaces their phone.
