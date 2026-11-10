import { NextRequest, NextResponse } from "next/server";
import { verifyAdminPassword } from "@/lib/admin-auth";
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

    const isValid = await verifyAdminPassword(password);
    if (!isValid) {
      await recordAdminAuditLog({
        action: "ADMIN_LOGIN_FAILED",
        actionLabel: "Failed Admin Login Attempt",
        ip,
        status: "FAILED",
        details: "Attempted login with incorrect organizer password.",
      });

      return NextResponse.json({ success: false, error: "Invalid organizer password" }, { status: 401 });
    }

    await recordAdminAuditLog({
      action: "ADMIN_LOGIN",
      actionLabel: "Successful Admin Login",
      ip,
      status: "SUCCESS",
      details: "Organizer authenticated successfully into Control Center.",
    });

    const response = NextResponse.json({
      success: true,
      message: "Organizer authenticated successfully",
    });

    // Set secure HTTP-only cookie containing the authenticated password
    response.cookies.set("santa_admin_token", password, {
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
