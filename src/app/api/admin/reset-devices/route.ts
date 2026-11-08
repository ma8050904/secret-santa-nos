import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { resetAllDeviceBindings } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    if (!verifyAdminRequest(req)) {
      return NextResponse.json({ success: false, error: "Unauthorized. Admin credentials required." }, { status: 401 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";

    const result = await resetAllDeviceBindings(ip);

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error resetting device bindings";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
