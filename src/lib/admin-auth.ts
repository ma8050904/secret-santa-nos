import { NextRequest } from "next/server";
import { APP_CONFIG } from "./constants";
import { secureCompare } from "./crypto";

export function verifyAdminRequest(req: NextRequest): boolean {
  const adminPassword = APP_CONFIG.ADMIN_DEFAULT_PASSWORD;

  // Check header
  const authHeader = req.headers.get("x-admin-password") || req.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (secureCompare(token, adminPassword)) {
      return true;
    }
  }

  // Check cookie
  const cookiePassword = req.cookies.get("santa_admin_token")?.value;
  if (cookiePassword && secureCompare(cookiePassword, adminPassword)) {
    return true;
  }

  return false;
}
