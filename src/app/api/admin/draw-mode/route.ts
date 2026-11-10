import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { setDrawMode } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!(await verifyAdminRequest(req))) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Admin credentials required." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    const mode = body?.mode;

    if (mode !== "free" && mode !== "constrained") {
      return NextResponse.json(
        { success: false, error: "Invalid draw mode. Expected 'free' or 'constrained'." },
        { status: 400 }
      );
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";

    const result = await setDrawMode(mode, ip);
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("Set draw mode error:", err);
    const message = err instanceof Error ? err.message : "Error switching draw mode.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
