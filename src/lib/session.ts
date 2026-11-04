import { NextRequest } from "next/server";
import crypto from "crypto";
import { createSessionToken, verifySessionToken } from "./crypto";

const SESSION_COOKIE_NAME = "santa_session_v7_clean";
const LEGACY_SESSION_COOKIE = "santa_participant_session";
const DEVICE_COOKIE_NAME = "santa_device_v7_clean";
const LEGACY_DEVICE_COOKIE = "santa_device_id";

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

export function setSessionCookie(
  response: { cookies: { set: (name: string, value: string, options: any) => void } },
  participantId: string
) {
  const token = createSessionToken(participantId, SESSION_SECRET);
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

export function getSessionFromRequest(req: NextRequest): { participantId: string } | null {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      return verifySessionToken(token, SESSION_SECRET);
    }
    return null;
  }
  return verifySessionToken(cookie, SESSION_SECRET);
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
