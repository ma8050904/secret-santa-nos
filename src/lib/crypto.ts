import crypto from "crypto";

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LEN = 32; // 256 bits for AES-256
const PBKDF2_DIGEST = "sha256";
const GCM_IV_LENGTH = 12; // 96 bits recommended for AES-GCM
const GCM_TAG_LENGTH = 16; // 128 bits auth tag

/**
 * Derives a 256-bit encryption key from a participant's secret access code or PIN and salt
 */
export function deriveKeyFromPasscode(passcode: string, salt: string): Buffer {
  const normalized = passcode.trim();
  return crypto.pbkdf2Sync(
    normalized,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_LEN,
    PBKDF2_DIGEST
  );
}

/**
 * Encrypts a recipient's name using AES-256-GCM with the key derived from participant's passcode or PIN
 * Returns a serialized string format: iv:authTag:ciphertext (all base64)
 */
export function encryptRecipient(recipientName: string, passcode: string, salt: string): string {
  const key = deriveKeyFromPasscode(passcode, salt);
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let ciphertext = cipher.update(recipientName, "utf8", "base64");
  ciphertext += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext}`;
}

/**
 * Decrypts a recipient's name using AES-256-GCM with the key derived from participant's passcode or PIN
 * Throws an error if the passcode/PIN is incorrect or data was tampered with
 */
export function decryptRecipient(encryptedData: string, passcode: string, salt: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const key = deriveKeyFromPasscode(passcode, salt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextB64, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Hash a passcode/PIN for secure storage & verification without exposing the plaintext passcode
 */
export function hashPasscode(passcode: string, salt: string): string {
  const normalized = passcode.trim();
  const hash = crypto.createHmac("sha256", salt).update(normalized).digest("hex");
  return hash;
}

/**
 * Robust salted hashing for personal PINs with PBKDF2
 */
export function hashPin(pin: string, salt: string): string {
  const normalized = pin.trim();
  const derived = crypto.pbkdf2Sync(normalized, salt, 100000, 32, "sha256");
  return derived.toString("hex");
}

/**
 * Constant-time comparison of two strings to prevent timing side-channel attacks
 */
export function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Constant-time PIN verification
 */
export function verifyPin(enteredPin: string, storedHash: string, salt: string): boolean {
  const computed = hashPin(enteredPin, salt);
  return secureCompare(computed, storedHash);
}

/**
 * Generates a clean, memorable, high-entropy Christmas access code
 */
export function generateChristmasPasscode(): string {
  const prefixes = ["SANTA", "NOEL", "FROST", "JOLLY", "MERRY", "BELLS", "STAR", "GIFT"];
  const prefix = prefixes[crypto.randomInt(0, prefixes.length)];
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // exclude 0, 1, I, O to prevent confusion
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return `${prefix}-${code}`;
}

/**
 * Generates a cryptographically secure random salt
 */
export function generateRandomSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Cryptographic session token generation (HMAC-SHA256 signed).
 * Binds participantId and optionally deviceId, timestamp, and cryptographic nonce.
 */
export function createSessionToken(
  participantId: string,
  secret: string,
  deviceId?: string
): string {
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(8).toString("hex");
  const devId = deviceId ? deviceId.trim().toLowerCase() : "";
  const payload = `${participantId}:${devId}:${timestamp}:${nonce}`;
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Cryptographic session token verification.
 * Verifies HMAC signature, lifetime, and bound device ID.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  expectedDeviceId?: string,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000 // 7 days
): { participantId: string; deviceId?: string } | null {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payloadB64, signature] = token.split(".");
  const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");

  if (!secureCompare(signature, expectedSig)) {
    return null;
  }

  try {
    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const parts = payload.split(":");
    let participantId: string;
    let boundDeviceId = "";
    let timestamp: number;

    if (parts.length === 4) {
      // Modern format: participantId:boundDeviceId:timestamp:nonce
      participantId = parts[0];
      boundDeviceId = parts[1];
      timestamp = parseInt(parts[2], 10);
    } else if (parts.length === 3) {
      // Legacy format: participantId:timestamp:nonce
      participantId = parts[0];
      timestamp = parseInt(parts[1], 10);
    } else {
      return null;
    }

    if (isNaN(timestamp) || Date.now() - timestamp > maxAgeMs) {
      return null;
    }

    if (boundDeviceId && expectedDeviceId) {
      if (boundDeviceId !== expectedDeviceId.trim().toLowerCase()) {
        return null;
      }
    }

    return { participantId, deviceId: boundDeviceId || undefined };
  } catch {
    return null;
  }
}
