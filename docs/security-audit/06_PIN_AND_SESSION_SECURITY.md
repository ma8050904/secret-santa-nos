# 06 — PIN AND SESSION SECURITY AUDIT
## Cryptographic Hashing, Rate-Limiting Mechanics, and Session Integrity

**Audit Target:** 4-Digit PIN Authentication & Session Management  
**Files Audited:**
- `src/lib/crypto.ts`
- `src/lib/session.ts`
- `src/lib/rate-limit.ts`
- `src/app/api/auth/pin/route.ts`

---

## 1. PIN CRYPTOGRAPHIC INTEGRITY

### Hashing Algorithm:
Located in `src/lib/crypto.ts`:
```ts
export function hashPin(pin: string, salt: string): string {
  return crypto.pbkdf2Sync(pin, salt, 10000, 32, "sha256").toString("hex");
}
```
- **Iterations:** 10,000 rounds of PBKDF2 with SHA-256.
- **Salt:** 16 bytes of cryptographically secure random bytes generated per participant (`crypto.randomBytes(16).toString("hex")`).
- **Verdict:** Cryptographically strong against precomputed rainbow table attacks.

### The Entropy Limitation:
- A 4-digit numeric PIN has only $10^4 = 10,000$ possible combinations.
- An attacker can compute all 10,000 hashes in under 20 milliseconds on a standard GPU once the salt is known.
- Therefore, the security of the PIN depends **entirely on server-side rate limiting and brute-force lockout**.

---

## 2. SERVERLESS RATE-LIMITING VULNERABILITY

### Implementation in `src/lib/rate-limit.ts`:
```ts
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitEntry>();
```
- The rate limiter allows 5 failed attempts per 60 seconds per `ip:participantId`.

### The Critical Flaw (Ephemeral Serverless Memory):
- Vercel Functions run in ephemeral microVMs (containers/lambdas).
- Memory (`rateLimitMap`) is **isolated to a single lambda container** and is not shared across instances.
- If an attacker sends concurrent parallel requests from rotating IP addresses or floods the endpoint, Vercel autoscales across 10+ container instances.
- Each instance starts with an empty `rateLimitMap`.
- **Consequence:** An automated brute-force attack can test all 10,000 PIN combinations within minutes by distributing requests across concurrent lambda instances.
- **Classification:** `VERIFIED` / `SECURITY GAPS IDENTIFIED`.
- **Mitigation:** Replace in-memory rate limiting with an external distributed store like Upstash Redis.

---

## 3. SESSION INTEGRITY & LIFECYCLE

### Session Token Construction (`src/lib/session.ts`):
```ts
export function createSessionToken(participantId: string, secret: string): string {
  const payload = `${participantId}:${Date.now()}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}:${signature}`;
}
```
- Signed using HMAC-SHA256 with `SESSION_SECRET`.
- Stored in HTTP-only, Secure, SameSite=Lax cookie (`santa_session_v7_clean`).
- **Session Lock:** All protected routes (`/api/reveal`, `/api/auth/pin`) verify that the session's `participantId` matches the request payload.
- **Round Invalidation:** When a full draw is regenerated, the round version changes, which invalidates old draws and encrypts recipient names under a new `masterSalt`.
- **Classification:** `VERIFIED SECURE`.
