import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { APP_CONFIG } from "./constants";
import { secureCompare } from "./crypto";
import { getEventState } from "./storage";

const ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  process.env.SESSION_SECRET ||
  "SantaMagic2024_Admin_WebAuthn_Passkey_Secret_Key_v7";

const ADMIN_COOKIE_NAME = "santa_admin_token";

/**
 * Returns WebAuthn RP details (RP ID and Origin) derived dynamically from request headers.
 */
export function getWebAuthnRpDetails(req: NextRequest): { rpID: string; origin: string } {
  const hostHeader =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "secret-santa-nos.vercel.app";

  const rawHostname = hostHeader.split(":")[0].toLowerCase();

  // Whitelist check to prevent Host header injection attacks on WebAuthn RP ID and Origin
  const isAllowedHost =
    rawHostname === "secret-santa-nos.vercel.app" ||
    rawHostname === "secret-santa-holiday.vercel.app" ||
    rawHostname.endsWith(".vercel.app") ||
    rawHostname === "localhost" ||
    rawHostname === "127.0.0.1" ||
    Boolean(process.env.APP_DOMAIN && rawHostname === process.env.APP_DOMAIN.toLowerCase());

  const hostname = isAllowedHost ? rawHostname : "secret-santa-nos.vercel.app";
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https");

  const port =
    (hostname === "localhost" || hostname === "127.0.0.1") && hostHeader.includes(":")
      ? `:${hostHeader.split(":")[1]}`
      : "";

  const origin = `${proto}://${hostname}${port}`;
  return { rpID: hostname, origin };
}

/**
 * Creates an HMAC-SHA256 signed session token for authenticated admin.
 */
export function createAdminSessionToken(): string {
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `admin:${timestamp}:${nonce}`;
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `adm.${payloadB64}.${signature}`;
}

/**
 * Validates an HMAC-SHA256 signed admin session token.
 * Max token lifetime: 14 days.
 */
export function verifyAdminSessionToken(token: string): boolean {
  if (!token || !token.startsWith("adm.")) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [, payloadB64, signature] = parts;
  const expectedSig = crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");

  if (!secureCompare(signature, expectedSig)) return false;

  try {
    const raw = Buffer.from(payloadB64, "base64url").toString("utf8");
    const [role, timeStr] = raw.split(":");
    if (role !== "admin") return false;
    const issuedAt = parseInt(timeStr, 10);
    const maxAgeMs = 14 * 24 * 60 * 60 * 1000; // 14 days
    if (Date.now() - issuedAt > maxAgeMs) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Sets the admin session cookie on an outgoing response.
 * Session-scoped (no persistent maxAge) so it expires when the browser session ends.
 */
export function setAdminSessionCookie(res: NextResponse): string {
  const token = createAdminSessionToken();
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return token;
}

/**
 * Clears the admin session cookie.
 */
export function clearAdminSessionCookie(res: NextResponse) {
  res.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function verifyAdminPassword(candidate: string): Promise<boolean> {
  if (!candidate || typeof candidate !== "string") return false;
  try {
    const state = await getEventState();
    if (state.adminPasswordHash && state.adminPasswordSalt) {
      const candidateHash = crypto
        .scryptSync(candidate, state.adminPasswordSalt, 32)
        .toString("hex");
      if (secureCompare(candidateHash, state.adminPasswordHash)) {
        return true;
      }
    }
  } catch {
    // fallback
  }

  const defaultPassword = process.env.ADMIN_PASSWORD || APP_CONFIG.ADMIN_DEFAULT_PASSWORD;
  return secureCompare(candidate, defaultPassword);
}

export async function verifyAdminRequest(req: NextRequest): Promise<boolean> {
  // 1. Check Authorization or x-admin-password header
  const authHeader = req.headers.get("x-admin-password") || req.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (verifyAdminSessionToken(token) || (await verifyAdminPassword(token))) {
      return true;
    }
  }

  // 2. Check santa_admin_token cookie
  const cookieVal = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (cookieVal) {
    if (verifyAdminSessionToken(cookieVal) || (await verifyAdminPassword(cookieVal))) {
      return true;
    }
  }

  return false;
}
