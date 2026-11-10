# 10 — SECURITY REMEDIATION ROADMAP
## Prioritized Engineering Plan to Resolve All Audit Findings

---

## 1. REMEDIATION PRIORITY MATRIX

| Priority | Issue / Finding | Impact | Proposed Fix | Effort |
|---|---|---|---|---|
| **P0 (Critical / Immediate)** | **Vercel Blob Store Exhaustion (`Your store is blocked`)** | Complete disruption of live authentication; returns 403. | Create new Vercel Blob store token or enable Vercel Blob Pro spending limit. | 15 mins (Vercel Dashboard) |
| **P0 (Critical / Immediate)** | **WebAuthn Base64URL Crash (`The string contains invalid characters`)** | Touch ID / Face ID fails to open; crashes in `atob()`. | Add strict base64url regex filter (`/^[A-Za-z0-9_-]+$/`) to `getAllRegisteredPasskeyCredentials()`. | 30 mins (Code fix) |
| **P1 (High)** | **Serverless Rate-Limit Bypass (Ephemeral Memory)** | Brute force of 4-digit PIN possible across distributed lambdas. | Migrate `rateLimitMap` to Upstash Redis (`@upstash/ratelimit`). | 2 hours |
| **P1 (High)** | **Blob Read JSON Validation & Fallback Guard** | Non-JSON text from Blob (`Your store is blocked`) breaks state parsing. | Wrap Blob reads in strict content-type check; throw clean structured error if response is not JSON. | 1 hour |
| **P2 (Medium)** | **Direct API Fingerprint Forgery (cURL / Postman)** | Attacker can bypass hardware binding by sending fake `x-hardware-fingerprint`. | Require signed enrollment tokens or server-generated registration challenge. | 3 hours |
| **P3 (Operational)** | **Passkey Sync Across Multiple Devices (iCloud Keychain)** | User can open account on synced iPad/Mac. | Add optional secondary PIN challenge when authenticating from a newly detected device ID. | 2 hours |

---

## 2. DETAILED CODE FIXES FOR P0 VULNERABILITIES

### Fix 1: Base64URL Credential Sanitizer
In `src/lib/storage.ts`:
```ts
export async function getAllRegisteredPasskeyCredentials(): Promise<string[]> {
  await syncMarkers();
  const rawCreds = new Set<string>(allRegisteredCredentialIdsSet);

  for (const [, p] of runtimeParticipantCache) {
    if (p.passkeyCredentialId) rawCreds.add(p.passkeyCredentialId.trim());
  }

  // Filter ONLY valid base64url strings to prevent atob crashes
  const base64UrlRegex = /^[A-Za-z0-9_-]{16,}$/;
  const sanitizedCreds = Array.from(rawCreds).filter((id) => base64UrlRegex.test(id));

  return sanitizedCreds;
}
```

### Fix 2: Blob Read JSON Guard
In `src/lib/storage.ts`:
```ts
if (res && res.stream) {
  const text = await new Response(res.stream).text();
  if (text.includes("Your store is blocked") || !text.trim().startsWith("{")) {
    console.error("Critical: Vercel Blob store is blocked or returned non-JSON:", text);
    return null;
  }
  const parsed = JSON.parse(text);
  return parsed;
}
```
