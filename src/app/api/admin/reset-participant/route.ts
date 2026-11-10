import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { resetSingleParticipant } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!(await verifyAdminRequest(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized. Admin credentials required." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const participantId = body?.participantId;

    if (!participantId || typeof participantId !== "string") {
      return NextResponse.json({ success: false, error: "Participant ID is required." }, { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";

    const result = await resetSingleParticipant(participantId, ip);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error resetting participant.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
