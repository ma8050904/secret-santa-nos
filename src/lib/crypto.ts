import crypto from "crypto";

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LEN = 32; // 256 bits for AES-256
const PBKDF2_DIGEST = "sha256";
const GCM_IV_LENGTH = 12; // 96 bits recommended for AES-GCM
const GCM_TAG_LENGTH = 16; // 128 bits auth tag

/**
 * Derives a 256-bit encryption key from a participant's secret access code and salt
 */
export function deriveKeyFromPasscode(passcode: string, salt: string): Buffer {
  const normalized = passcode.trim().toUpperCase();
  return crypto.pbkdf2Sync(
    normalized,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_LEN,
    PBKDF2_DIGEST
  );
}

/**
 * Encrypts a recipient's name using AES-256-GCM with the key derived from participant's passcode
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
 * Decrypts a recipient's name using AES-256-GCM with the key derived from participant's passcode
 * Throws an error if the passcode is incorrect or data was tampered with
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
 * Hash a passcode for secure storage & verification without exposing the plaintext passcode
 */
export function hashPasscode(passcode: string, salt: string): string {
  const normalized = passcode.trim().toUpperCase();
  const hash = crypto.createHmac("sha256", salt).update(normalized).digest("hex");
  return hash;
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
 * Generates a clean, memorable, high-entropy Christmas access code
 * Format: e.g. "SANTA-7K4M" or "NOEL-9X2F" or "JINGLE-4P8T"
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
