import { NextRequest } from "next/server";
import crypto from "crypto";
import { createSessionToken, verifySessionToken } from "./crypto";

const SESSION_COOKIE_NAME = "santa_session_v7_clean";
const LEGACY_SESSION_COOKIE = "santa_participant_session";
const DEVICE_COOKIE_NAME = "santa_device_v7_clean";
const LEGACY_DEVICE_COOKIE = "santa_device_id";

// Section 1.2: Signed HttpOnly Cookie ss_bound_participant
export const BOUND_COOKIE_NAME = "ss_bound_participant";
export const CHALLENGE_COOKIE_NAME = "santa_biometric_challenge";

const SESSION_SECRET =
  process.env.SESSION_SECRET || "SantaMagic2024_Round7_FinalClean_v7_Production_Strict";

export function isValidUUID(id: string | null | undefined): boolean {
  if (!id || typeof id !== "string") return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(id.trim());
}

export function generateServerDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Computes an HMAC-SHA256 signature for a participant ID to guarantee cookie integrity.
 */
export function signBoundParticipant(participantId: string): string {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(`bound:${participantId.trim().toLowerCase()}`)
    .digest("base64url");
}

/**
 * Verifies the HMAC-SHA256 signature on an ss_bound_participant cookie.
 * Returns the validated participantId, or null if invalid or tampered.
 */
export function verifyBoundParticipant(cookieValue: string | null | undefined): string | null {
  if (!cookieValue || typeof cookieValue !== "string") return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [participantId, sig] = parts;
  if (!participantId || !sig) return null;
  const expectedSig = signBoundParticipant(participantId);
  try {
    const isMatch = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
    return isMatch ? participantId.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Sets the signed HttpOnly ss_bound_participant cookie on an outgoing response.
 * Max-Age = 31536000 (1 year), SameSite = Lax, Secure.
 */
export function setBoundParticipantCookie(
  response: { cookies: { set: (name: string, value: string, options: any) => void } },
  participantId: string
) {
  const cleanId = participantId.trim().toLowerCase();
  const signature = signBoundParticipant(cleanId);
  response.cookies.set(BOUND_COOKIE_NAME, `${cleanId}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 31536000, // 1 year
  });
}

/**
 * Extracts and cryptographically verifies the bound participant ID from the request's cookies.
 */
export function getBoundParticipantFromRequest(req: NextRequest): string | null {
  const cookie = req.cookies.get(BOUND_COOKIE_NAME)?.value;
  return verifyBoundParticipant(cookie);
}

/**
 * Sets an HMAC-SHA256 signed WebAuthn challenge cookie tied specifically to this participantId and mode.
 */
export function setBiometricChallengeCookie(
  response: { cookies: { set: (name: string, value: string, options: any) => void } },
  mode: "register" | "authenticate",
  challenge: string,
  participantId: string
) {
  const cleanId = participantId.trim().toLowerCase();
  const payload = `${mode}:${challenge}:${cleanId}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  response.cookies.set(CHALLENGE_COOKIE_NAME, `${payload}:${sig}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 300, // 5 minutes
  });
}

/**
 * Verifies that the WebAuthn challenge belongs to this participant, mode, and has a valid HMAC signature.
 * Returns the raw challenge string or null if invalid or expired.
 */
export function verifyBiometricChallengeCookie(
  req: NextRequest,
  expectedMode: "register" | "authenticate",
  participantId: string
): string | null {
  const val = req.cookies.get(CHALLENGE_COOKIE_NAME)?.value;
  if (!val) return null;
  const parts = val.split(":");
  if (parts.length !== 4) return null;
  const [mode, challenge, pId, sig] = parts;
  const cleanId = participantId.trim().toLowerCase();
  if (mode !== expectedMode || pId.toLowerCase() !== cleanId) return null;
  const expectedPayload = `${mode}:${challenge}:${cleanId}`;
  const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(expectedPayload).digest("base64url");
  try {
    const isMatch = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
    return isMatch ? challenge : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(
  response: { cookies: { set: (name: string, value: string, options: any) => void } },
  participantId: string,
  deviceId?: string
) {
  const token = createSessionToken(participantId, SESSION_SECRET, deviceId);
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  // Clear legacy cookie if present
  response.cookies.set(LEGACY_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return token;
}

export function setDeviceCookie(
  response: { cookies: { set: (name: string, value: string, options: any) => void } },
  deviceId: string
) {
  response.cookies.set(DEVICE_COOKIE_NAME, deviceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
  // Clear legacy device cookie
  response.cookies.set(LEGACY_DEVICE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function clearSessionCookie(response: {
  cookies: { set: (name: string, value: string, options: any) => void };
}) {
  for (const name of [
    SESSION_COOKIE_NAME,
    LEGACY_SESSION_COOKIE,
    DEVICE_COOKIE_NAME,
    LEGACY_DEVICE_COOKIE,
    BOUND_COOKIE_NAME,
    CHALLENGE_COOKIE_NAME,
  ]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}

export function getSessionFromRequest(req: NextRequest): { participantId: string; deviceId?: string } | null {
  const deviceId = getDeviceIdFromRequest(req);
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      return verifySessionToken(token, SESSION_SECRET, deviceId);
    }
    return null;
  }
  return verifySessionToken(cookie, SESSION_SECRET, deviceId);
}

export function getDeviceIdFromRequest(req: NextRequest): string {
  // Check header first
  const headerId = req.headers.get("x-device-id");
  if (headerId && isValidUUID(headerId)) {
    return headerId.trim().toLowerCase();
  }

  // Check cookie second
  const cookieId = req.cookies.get(DEVICE_COOKIE_NAME)?.value;
  if (cookieId && isValidUUID(cookieId)) {
    return cookieId.trim().toLowerCase();
  }

  // Generate a valid server-side UUID fallback
  return generateServerDeviceId();
}

export function getHardwareFingerprintFromRequest(req: NextRequest): string | null {
  const headerFp = req.headers.get("x-hardware-fingerprint");
  if (headerFp && headerFp.trim().length > 5) {
    return headerFp.trim().toLowerCase();
  }
  const cookieFp = req.cookies.get("santa_hw_fp")?.value;
  if (cookieFp && cookieFp.trim().length > 5) {
    return cookieFp.trim().toLowerCase();
  }
  return null;
}
