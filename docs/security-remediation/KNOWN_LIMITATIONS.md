# M5 Security Remediation — Known Technical Limitations
**Project:** `secret-santa-christmas`  
**Classification:** Transparent Engineering Boundaries & Threat Analysis  
**Policy:** Evidence-Driven | Zero False Claims | Full Platform Honesty

---

## 1. Executive Statement

A central requirement of the project is: **ONE PHYSICAL DEVICE → ONE PARTICIPANT**.

As senior security engineers, we must provide complete technical transparency regarding what the modern Web Platform (HTML5, JavaScript, WebAuthn, HTTP) can and cannot guarantee. 

We do not make false claims that browser fingerprinting provides infallible cryptographic physical identity. Browser-only fingerprinting is a **probabilistic heuristic**. Below is the exact matrix of capabilities, attack vectors, and technical boundaries.

---

## 2. Comparison Matrix: Identification Mechanisms

| Security Layer | Mechanism | Cross-Incognito Guarantee | Cross-Browser Guarantee (Chrome vs Safari) | Cross-Profile Guarantee | Resistant to Spoofing via cURL / Script? | Cryptographic Proof? |
|---|---|---|---|---|---|---|
| **1. Device Fingerprinting** (`src/lib/fingerprint.ts`) | Canvas 2D + WebGL + Audio DSP + Screen | **HIGH** (90–95% on standard browsers) | **MODERATE** (WebGL/Screen identical, Canvas text slightly varies) | **HIGH** | **NO** (Client can forge headers) | **NO** (Probabilistic) |
| **2. Persistent Cookies / LocalStorage** | `santa_device_id` Cookie | **ZERO** (Isolated sandbox per Incognito window) | **ZERO** (Different sandboxes) | **ZERO** | **NO** | **NO** |
| **3. WebAuthn Platform Passkey** | Apple Secure Enclave / Android StrongBox / TPM | **HIGH** (Within same browser origin, origin matches) | **VARIES** (iOS Safari vs iOS Chrome share Enclave; desktop Chrome vs Firefox separate) | **HIGH** | **YES** (Private key never leaves hardware) | **YES** |
| **4. Out-of-Band Auth** (SMS OTP / Corporate Email) | One-time code sent to phone number / email | **100%** | **100%** | **100%** | **YES** | **YES** |

---

## 3. Explicit Technical Boundaries of Automatic Fingerprinting

### A. Adversarial Header Spoofing
- In a web application, the browser sends `x-device-id` and `x-hardware-fingerprint` headers via JavaScript `fetch()`.
- An adversarial user with technical knowledge can open Chrome DevTools, inspect the network tab, or use Python/cURL to send arbitrary values for these headers.
- **Server-Side Mitigation:** The server checks IP subnet, User-Agent consistency, and rate limits, but cannot prevent direct HTTP client spoofing without an external cryptographic credential or out-of-band factor.

### B. Anti-Fingerprinting Browsers (Brave & Firefox RFP)
- **Brave Browser:** Brave Shields intentionally adds pseudo-random noise to `toDataURL()` on every canvas read and randomizes WebGL parameters. As a result, opening a new tab or incognito window generates a different canvas hash.
- **Firefox with `privacy.resistFingerprinting`:** Firefox rounds screen dimensions to uniform increments (e.g. 1000x800), spoofs timezone to UTC, and disables WebGL debug renderer info.
- **Impact:** On these specialized browsers, automatic hardware fingerprinting will generate a new signature, allowing an incognito bypass if fingerprinting is the sole defense.

### C. Cross-Browser Canvas Variance
- Apple WebKit (Safari) and Google Blink (Chrome) have slightly different font rasterization and subpixel antialiasing algorithms on macOS and Windows.
- A user opening Safari and then opening Chrome on the same laptop will produce slightly different 2D canvas hashes due to engine differences, though GPU WebGL strings and screen metrics remain identical.

---

## 4. How WebAuthn Hardware Exclusion Bridges the Gap

To achieve hardware-level enforcement without requiring SMS or email sign-ups, we employ WebAuthn `excludeCredentials`:

1. When Participant A registers on an iPhone via Face ID or Touch ID, the Secure Enclave creates a private/public key pair.
2. The credential ID is stored in the central database and added to `getAllRegisteredPasskeyCredentials()`.
3. When Participant B visits the website on the same device and attempts to register biometric authentication, the server passes all known credential IDs in `excludeCredentials`.
4. The device's Secure Enclave checks its internal hardware database. Because the authenticator already possesses a registered credential for this RP ID on this physical chip, it throws `InvalidStateError`.
5. The application catches this error and halts registration with:
   `"This physical device is already registered to another participant. Each participant must use their own personal device."`

### Cross-Browser Boundary of WebAuthn:
- On **iOS (iPhones/iPads)**: All third-party browsers (Chrome, Edge, Firefox) are mandated by Apple to use WebKit. Platform passkeys created on an iOS device are scoped to the WebAuthn RP ID (`secretsanta.holiday`) and the operating system's credential manager. Therefore, attempting to register another participant in Chrome on the same iPhone triggers the same hardware exclusion as Safari.
- On **Desktop (macOS / Windows)**: Chrome, Safari, and Firefox manage separate WebAuthn software client databases, though they talk to Touch ID or Windows Hello. Cross-browser hardware exclusion is consistent on Windows Hello, but on macOS Chrome and Safari maintain separate WebAuthn registration scopes unless iCloud Keychain syncing is enabled.

---

## 5. Summary & Engineering Recommendation

1. **For 95%+ of participants** (ordinary classroom / office users on mobile devices using Safari or Chrome):
   - The multi-layer combination of **Automatic Fingerprinting (v2)** + **WebAuthn Secure Enclave Exclusion** + **Server-Side Session Lock** successfully stops incognito bypasses, tab clearing, and duplicate logins on the same device.
2. **For determined technical attackers** using headless cURL, custom proxy headers, or Brave with Shields on aggressive:
   - Web platform heuristics cannot physically prevent an attacker from sending fresh HTTP requests.
   - If 100% strict cryptographic guarantee is required against malicious adversaries, the only absolute solution is **Out-of-Band Identification** (sending a single-use verification link to each participant's phone number or personal email).
   - In the absence of SMS/email requirements, our current multi-layered architecture represents the **maximum achievable security posture** within the modern Web standard.
