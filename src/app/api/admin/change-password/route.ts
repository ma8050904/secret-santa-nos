import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest, setAdminSessionCookie } from "@/lib/admin-auth";
import { updateAdminPassword } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    if (!(await verifyAdminRequest(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized. Current admin credentials required." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const newPassword = body?.newPassword;

    if (!newPassword || typeof newPassword !== "string" || newPassword.trim().length < 6) {
      return NextResponse.json(
        { success: false, error: "New password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    const result = await updateAdminPassword(newPassword.trim());

    const response = NextResponse.json(result);
    // Securely issue HMAC-SHA256 signed admin session token instead of storing raw password
    setAdminSessionCookie(response);

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error updating admin password";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
