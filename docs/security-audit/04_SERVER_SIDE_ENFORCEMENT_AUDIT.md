# 04 — SERVER-SIDE ENFORCEMENT AUDIT
## Backend Authorization, Endpoint Protection, and Storage Resilience

**Audit Target:** All Next.js Serverless Route Handlers  
**Files Audited:**
- `src/app/api/auth/pin/route.ts`
- `src/app/api/auth/biometric/options/route.ts`
- `src/app/api/auth/biometric/verify/route.ts`
- `src/app/api/reveal/route.ts`
- `src/app/api/auth/device-status/route.ts`
- `src/app/api/auth/session/route.ts`

---

## 1. ENDPOINT AUTHORIZATION MATRIX

| Route | Method | Auth Required | Device Enforcement | Session Lock | Persistence Layer | Validation / Failure Behavior |
|---|---|---|---|---|---|---|
| `/api/auth/pin` | `POST` | None (Public login) | `getDeviceOrHardwareBinding` | Rejects if existing session belongs to another participant. | Binds device in `v7/devices/` and `v7/hardware_devices/`. | 4-digit min PIN; returns HTTP 403 if device or hardware is bound to another participant. |
| `/api/auth/biometric/options` | `POST` | None (Initial step) | `getDeviceOrHardwareBinding` | None | None (Challenge cookie written). | Returns HTTP 403 if device/hardware bound to another participant. |
| `/api/auth/biometric/verify` | `POST` | Challenge Cookie | `getDeviceOrHardwareBinding` | Sets session cookie upon success. | Binds device in `v7/devices/` and `v7/hardware_devices/`. | Cryptographic signature verification via `@simplewebauthn/server`. Returns HTTP 403 on device mismatch. |
| `/api/reveal` | `POST` | Session Cookie OR PIN | `getDeviceOrHardwareBinding` | Enforces that session matches `participantId`. | Marks revealed in `v7/revealed/` and updates runtime state. | Rate-limited (10 req/min); returns HTTP 403 if device/hardware bound to another participant. |
| `/api/auth/device-status` | `GET` | None | `getDeviceOrHardwareBinding` | None | Read-only | Returns `{ bound: true, participantId, participantName }` or `{ bound: false }`. |
| `/api/auth/session` | `GET` | Session Cookie | None | Verifies HMAC-SHA256 session token. | Read-only | Returns authenticated participant record. |

---

## 2. SERVER-SIDE ENFORCEMENT FINDINGS

### A. The Device Binding Resolver (`getDeviceOrHardwareBinding`)
Located in `src/lib/storage.ts`:
```ts
export async function getDeviceOrHardwareBinding(
  deviceId: string,
  hwFp?: string | null
): Promise<DeviceBindingRecord | null> {
  const byDevice = await getDeviceBinding(deviceId);
  if (byDevice) return byDevice;
  if (hwFp && hwFp.trim().length > 5) {
    const byHw = await getHardwareDeviceBinding(hwFp);
    if (byHw) return byHw;
  }
  return null;
}
```

1. **Strength:**
   - Evaluates both the UUID `deviceId` AND the `hardwareFingerprint`.
   - If a device was previously bound under either identifier, any attempt to authenticate as a different participant returns HTTP 403.
2. **Vulnerability (Fail-Open on Missing Headers):**
   - If a client sends an unknown `deviceId` (e.g. from Incognito) AND strips the `x-hardware-fingerprint` header completely, `getDeviceOrHardwareBinding` returns `null` (unbound).
   - The server **does not require** `x-hardware-fingerprint` to be present.
   - **Classification:** `VERIFIED` / `SECURITY GAPS IDENTIFIED`.

---

## 3. STORAGE DEPENDENCY & INFRASTRUCTURE FRAGILITY

### The Vercel Blob Vulnerability:
All server-side persistence and device binding checks depend on `@vercel/blob` (`get` and `put`).
- When Vercel Blob exceeds quota or is rate-limited:
  - Blob calls return HTTP 403 (`Your store is blocked`).
  - `storage.ts` catches the error silently in many places (`catch { return null; }`).
  - When `getDeviceBinding` returns `null` due to a Blob failure, the server behaves as though the device is **UNBOUND**, allowing a bypass!
  - **Classification:** `OBSERVED` / `FAILED`.
