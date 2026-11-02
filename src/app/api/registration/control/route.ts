import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import {
  startRegistrationSession,
  pauseRegistrationSession,
  resumeRegistrationSession,
  skipRegistrationTurn,
  revisitParticipantRegistration,
  getRegistrationSessionStatus,
} from "@/lib/storage";

export async function POST(req: NextRequest) {
  // Organizer authentication check
  if (!verifyAdminRequest(req)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized. Organizer access required." },
      { status: 401 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action, participantId } = body;

    switch (action) {
      case "start":
        await startRegistrationSession();
        break;
      case "pause":
        await pauseRegistrationSession();
        break;
      case "resume":
        await resumeRegistrationSession();
        break;
      case "skip":
        await skipRegistrationTurn();
        break;
      case "revisit":
        if (!participantId || typeof participantId !== "string") {
          return NextResponse.json(
            { success: false, error: "Participant ID is required for revisit." },
            { status: 400 }
          );
        }
        const revisitRes = await revisitParticipantRegistration(participantId);
        if (!revisitRes.success) {
          return NextResponse.json(
            { success: false, error: revisitRes.error || "Could not revisit participant." },
            { status: 400 }
          );
        }
        break;
      default:
        return NextResponse.json(
          { success: false, error: "Invalid registration control action." },
          { status: 400 }
        );
    }

    const updated = await getRegistrationSessionStatus();
    return NextResponse.json({
      success: true,
      message: `Action '${action}' executed successfully.`,
      session: updated.session,
    });
  } catch (err: unknown) {
    console.error("Registration control error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to process registration control action." },
      { status: 500 }
    );
  }
}
