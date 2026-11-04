import { NextRequest } from "next/server";
import { createSessionToken, verifySessionToken } from "./crypto";

const SESSION_COOKIE_NAME = "santa_participant_session";
const SESSION_SECRET = process.env.SESSION_SECRET || "SantaMagic2024_Round7_SubgroupPartition_v7";

export function setSessionCookie(response: { cookies: { set: (name: string, value: string, options: any) => void } }, participantId: string) {
  const token = createSessionToken(participantId, SESSION_SECRET);
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return token;
}

export function clearSessionCookie(response: { cookies: { set: (name: string, value: string, options: any) => void } }) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function getSessionFromRequest(req: NextRequest): { participantId: string } | null {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    // Also check header Authorization: Bearer <token>
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      return verifySessionToken(token, SESSION_SECRET);
    }
    return null;
  }
  return verifySessionToken(cookie, SESSION_SECRET);
}
