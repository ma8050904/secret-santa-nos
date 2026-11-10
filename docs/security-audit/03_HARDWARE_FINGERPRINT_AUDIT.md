# 03 — HARDWARE FINGERPRINT FORENSIC AUDIT
## Client-Side Entropy, Stability, Spoofability, and SHA-256 Cryptographic Analysis

**Audit Target:** Client Hardware Fingerprinting Engine  
**File Audited:** `src/lib/fingerprint.ts`  
**Dependencies:** None (Pure browser APIs)

---

## 1. COMPONENT-BY-COMPONENT ENTROPY ANALYSIS

| Signal | Browser API Source | Extraction Mechanism | Entropy & Uniqueness | Stability (Normal vs Incognito) | Spoofability |
|---|---|---|---|---|---|
| **Canvas 2D** | `HTMLCanvasElement.getContext('2d')` | Renders text with emoji, linear gradients, shadowBlur, arcs, and subpixel hinting; extracts base64 data URL. | High across different OS and GPU font rasterizers; medium across identical phone models (e.g. all iPhone 15 Pro units render almost identical canvas). | **100% Identical** on same machine in standard and Incognito tabs. | **Trivial** via browser extensions or custom HTTP headers. |
| **WebGL Info** | `WEBGL_debug_renderer_info` | Queries `UNMASKED_VENDOR_WEBGL`, `UNMASKED_RENDERER_WEBGL`, max texture size, renderbuffer size, viewport dims, vertex attribs, and supported extensions array. | High between different GPU models (e.g., Apple M1 Pro vs Intel Iris vs Qualcomm Adreno); low among identical devices. | **100% Identical** across Normal and Private tabs on same browser. | **Trivial** via dev tools or direct API requests. |
| **AudioContext** | `OfflineAudioContext` | Renders a 10,000Hz triangle oscillator through a `DynamicsCompressorNode`; sums PCM samples 4500 to 5000. | Moderate across distinct CPU/DSP floating-point math implementations; low across identical silicon chips. | **100% Identical** across Normal and Incognito. | **Trivial** via direct API manipulation. |
| **Hardware Metrics** | `window.screen`, `navigator` | Reads `width`, `height`, `colorDepth`, `devicePixelRatio`, `hardwareConcurrency` (CPU cores), `maxTouchPoints`, and timezone. | Low (discrete categories: e.g., 8-core CPU, 5-touch points, 1920x1080 resolution). | **100% Identical** across Normal and Incognito. | **Trivial** to alter. |

---

## 2. STABILITY ACROSS BROWSER & SYSTEM EVENTS

1. **Normal vs Incognito:**
   - **Observed:** On standard macOS Safari, Google Chrome, and iOS Safari, the computed SHA-256 hash is **identical** between standard mode and private mode.
2. **Browser Updates:**
   - When Apple or Google updates subpixel font antialiasing (CoreText / FreeType) or changes WebGL supported extensions, the canvas and WebGL strings change, altering the SHA-256 hash.
   - **Consequence:** A legitimate participant whose browser updates will produce a new hash and may lose their existing device binding unless recovered.
3. **Privacy Browsers (Brave, Firefox with `privacy.resistFingerprinting`, Safari Advanced Tracking Protection):**
   - Brave Shields and Firefox RFP deliberately inject pseudo-random noise into Canvas 2D and AudioContext outputs on every page load.
   - **Consequence:** On Brave or hardened Firefox, the hash changes on every reload, completely defeating the binding mechanism.

---

## 3. THE SPOOFABILITY & REPLAY VULNERABILITY

### The Fundamental Flaw:
The client calculates:
```ts
const hashHex = ...;
cachedHwFingerprint = `hw_${hashHex}`;
document.cookie = `santa_hw_fp=${cachedHwFingerprint}; path=/; ...`;
```
And sends this value in the HTTP request header:
```http
x-hardware-fingerprint: hw_a1b2c3d4e5f6...
```

### Attack Proof-of-Concept:
An adversary wishing to register multiple participants on the same device does NOT need to crack WebGL or Canvas rendering. They simply open browser DevTools, or run a terminal script (`curl`):

```bash
# Register Participant 1 with arbitrary fingerprint A
curl -X POST https://secret-santa-holiday.vercel.app/api/auth/pin \
  -H "Content-Type: application/json" \
  -H "x-device-id: 00000000-0000-4000-8000-000000000001" \
  -H "x-hardware-fingerprint: hw_attacker_signature_001" \
  -d '{"participantId": "p1", "pin": "1234"}'

# Register Participant 2 with arbitrary fingerprint B (on the exact same computer!)
curl -X POST https://secret-santa-holiday.vercel.app/api/auth/pin \
  -H "Content-Type: application/json" \
  -H "x-device-id: 00000000-0000-4000-8000-000000000002" \
  -H "x-hardware-fingerprint: hw_attacker_signature_002" \
  -d '{"participantId": "p2", "pin": "5678"}'
```

Both requests will succeed because the server **trusts the client to declare its own hardware identity**.

### Cryptographic Distinction:
- Hashing an unverified string with SHA-256 does NOT prove its provenance.
- SHA-256 provides integrity for data that is already authentic; it does **not** authenticate the sender.
- **Classification:** `VERIFIED` / `SECURITY GAPS IDENTIFIED`.
- **Verdict:** Client-side fingerprinting is an effective **UI-level friction mechanism** against ordinary participants, but **cannot be considered a security boundary**.
