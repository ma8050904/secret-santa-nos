import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  try {
    if (!(await verifyAdminRequest(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized. Admin credentials required." }, { status: 401 });
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "Standalone device unbinding is permanently disabled to prevent gift snooping across participants. Please use 'Regenerate Draw' to reset pairings, reveals, and devices simultaneously.",
      },
      { status: 403 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
