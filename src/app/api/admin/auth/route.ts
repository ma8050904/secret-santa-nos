import { NextRequest, NextResponse } from "next/server";
import { APP_CONFIG } from "@/lib/constants";
import { secureCompare } from "@/lib/crypto";
import { recordAdminAuditLog } from "@/lib/storage";

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";

  try {
    const body = await req.json().catch(() => null);
    const password = body?.password;

    if (!password || typeof password !== "string") {
      return NextResponse.json({ success: false, error: "Password is required" }, { status: 400 });
    }

    if (!secureCompare(password, APP_CONFIG.ADMIN_DEFAULT_PASSWORD)) {
      await recordAdminAuditLog({
        action: "ADMIN_LOGIN_FAILED",
        actionLabel: "محاولة دخول إدارية فاشلة",
        ip,
        status: "FAILED",
        details: "Attempted login with incorrect organizer password.",
      });

      return NextResponse.json({ success: false, error: "Invalid organizer password" }, { status: 401 });
    }

    await recordAdminAuditLog({
      action: "ADMIN_LOGIN",
      actionLabel: "تسجيل دخول إداري ناجح",
      ip,
      status: "SUCCESS",
      details: "Organizer authenticated successfully into Control Center.",
    });

    const response = NextResponse.json({
      success: true,
      message: "Organizer authenticated successfully",
    });

    // Set secure HTTP-only cookie
    response.cookies.set("santa_admin_token", APP_CONFIG.ADMIN_DEFAULT_PASSWORD, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Authentication error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
