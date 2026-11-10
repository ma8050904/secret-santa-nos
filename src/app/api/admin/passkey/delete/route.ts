import { NextRequest, NextResponse } from "next/server";
import { removeAdminPasskey, recordAdminAuditLog } from "@/lib/storage";
import { verifyAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!(await verifyAdminRequest(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const id = body?.id;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ success: false, error: "Passkey ID is required." }, { status: 400 });
    }

    const removed = await removeAdminPasskey(id);
    if (!removed) {
      return NextResponse.json({ success: false, error: "Passkey not found." }, { status: 404 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    await recordAdminAuditLog({
      action: "DELETE_PASSKEY",
      actionLabel: "Delete Admin Passkey",
      ip,
      status: "SUCCESS",
      details: `Admin passkey ${id.slice(0, 10)}... was removed.`,
    });

    return NextResponse.json({ success: true, message: "Passkey removed successfully." });
  } catch (err: unknown) {
    console.error("Passkey delete error:", err);
    return NextResponse.json({ success: false, error: "Failed to delete passkey." }, { status: 500 });
  }
}
