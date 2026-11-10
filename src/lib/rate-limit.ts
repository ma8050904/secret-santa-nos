interface RateLimitRecord {
  attempts: number;
  firstAttemptAt: number;
  blockedUntil?: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout if exceeded

/**
 * Clean up old entries periodically
 */
function cleanupExpiredRecords() {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (record.blockedUntil && record.blockedUntil < now) {
      rateLimitStore.delete(key);
    } else if (!record.blockedUntil && now - record.firstAttemptAt > WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Check and record an attempt. Returns { allowed: boolean, remainingAttempts: number, retryAfterSec?: number }
 */
export function checkRateLimit(identifier: string): {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSec?: number;
} {
  cleanupExpiredRecords();
  const now = Date.now();
  const record = rateLimitStore.get(identifier);

  if (!record) {
    rateLimitStore.set(identifier, {
      attempts: 1,
      firstAttemptAt: now,
    });
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS - 1 };
  }

  // Check if currently blocked
  if (record.blockedUntil && record.blockedUntil > now) {
    const retryAfterSec = Math.ceil((record.blockedUntil - now) / 1000);
    return { allowed: false, remainingAttempts: 0, retryAfterSec };
  }

  // Check if outside window
  if (now - record.firstAttemptAt > WINDOW_MS) {
    record.attempts = 1;
    record.firstAttemptAt = now;
    delete record.blockedUntil;
    return { allowed: true, remainingAttempts: MAX_ATTEMPTS - 1 };
  }

  // Inside window, increment attempts
  record.attempts += 1;

  if (record.attempts > MAX_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION_MS;
    const retryAfterSec = Math.ceil(BLOCK_DURATION_MS / 1000);
    return { allowed: false, remainingAttempts: 0, retryAfterSec };
  }

  return { allowed: true, remainingAttempts: MAX_ATTEMPTS - record.attempts };
}

/**
 * Reset rate limit counter upon successful authentication
 */
export function resetRateLimit(identifier: string): void {
  rateLimitStore.delete(identifier);
}

/**
 * Clears all rate-limit counters and lockouts across all participants and IPs
 * when an authorized full event reset or draw regeneration is executed.
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}
