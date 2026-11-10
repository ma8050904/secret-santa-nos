import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { clearAdminAuditLogs, recordAdminAuditLog } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    if (!(await verifyAdminRequest(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized. Admin credentials required." }, { status: 401 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";

    const result = await clearAdminAuditLogs();

    // Log the reset itself as the first clean entry
    await recordAdminAuditLog({
      action: "RESET_AUDIT_LOGS",
      actionLabel: "Audit Logs Reset",
      ip,
      status: "SUCCESS",
      details: `Administrator cleared previous audit records (count: ${result.clearedCount}).`,
    });

    return NextResponse.json({ success: true, clearedCount: result.clearedCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error clearing audit logs";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
