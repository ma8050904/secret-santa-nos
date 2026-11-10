import { NextRequest } from "next/server";
import crypto from "crypto";
import { APP_CONFIG } from "./constants";
import { secureCompare } from "./crypto";
import { getEventState } from "./storage";

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
  // Check header
  const authHeader = req.headers.get("x-admin-password") || req.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (await verifyAdminPassword(token)) {
      return true;
    }
  }

  // Check cookie
  const cookiePassword = req.cookies.get("santa_admin_token")?.value;
  if (cookiePassword && (await verifyAdminPassword(cookiePassword))) {
    return true;
  }

  return false;
}
