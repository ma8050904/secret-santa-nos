# PIN & Session Security Report
## Cryptographic Hashing, Distributed Rate Limiting & Session Hygiene

- **Test Category:** PIN Authentication & Session Security
- **Lead Agent:** M5 Autonomous Red Team
- **Status:** ALL TESTS VERIFIED & PASSED

---

### 1. Cryptographic Architecture

1. **Password-Based Key Derivation:**
   - Participant PINs are hashed using Node.js `crypto.scryptSync` with unique 16-byte random cryptographic salts.
   - Distinct salts ensure that identical PINs (e.g. `1234`) produce completely different hash digests, preventing precomputation or rainbow table attacks.
2. **Timing-Attack Resistance:**
   - All string and hash comparisons use `crypto.timingSafeEqual` (wrapped in `secureCompare`) to eliminate side-channel timing leaks.

### 2. Attack Execution Matrix

| Test ID | Scenario Description | Attack Vector | Expected Behavior | Observed Behavior | Verdict |
|---|---|---|---|---|---|
| **ATK-PIN-01** | Bounded PIN Brute-Force Enumeration | 6 rapid consecutive incorrect PIN submissions | 5 attempts allowed; 6th attempt blocked with HTTP 429 and 900s lockout | Attempts 1–5 allowed; attempt 6 returned HTTP 429 (`retryAfterSec: 900`) | **PASS (VERIFIED)** |
| **ATK-PIN-02** | Short / Empty PIN Registration | Submission of PIN with length < 4 (`"123"` or `""`) | Server rejects establishment with HTTP 400 | Rejected with: *"PIN must be at least 4 characters."* | **PASS (VERIFIED)** |
| **ATK-PIN-03** | HMAC Session Token Forgery | Tampering with token payload or signature bytes | Server validates HMAC-SHA256 signature; rejects modified token | Tampered token failed `verifySessionToken`; rejected immediately | **PASS (VERIFIED)** |
| **ATK-PIN-04** | Session Fixation / Cross-Account Access | Authenticated Participant 1 session token sent to Participant 2 endpoints | Server checks session lock; returns HTTP 403 | Request blocked: *"This session is locked to an authenticated participant account."* | **PASS (VERIFIED)** |
| **ATK-PIN-05** | Distributed Rate Limiter Multi-Instance Lock | Rate limit key tracked in database across serverless instances | Lockout enforced regardless of lambda container routing | `distributed_rate_limits` table tracks key atomically across serverless microVMs | **PASS (VERIFIED)** |

### 3. Rate Limiting Implementation Details

- **Table:** `distributed_rate_limits` (`key VARCHAR(128) PRIMARY KEY, attempts INT, first_attempt_at BIGINT, blocked_until BIGINT`)
- **Key Composition:** `${clientIp}:${participantId}` (or `reveal:${clientIp}:${participantId}`)
- **Policy:**
  * Maximum 5 attempts per 15-minute sliding window.
  * On attempt 6, `blocked_until` is set to `Date.now() + 15 * 60 * 1000`.
  * Lockout duration: 900 seconds (15 minutes).
  * Successful authentication automatically resets the rate limit counter via `resetDistributedRateLimit`.
