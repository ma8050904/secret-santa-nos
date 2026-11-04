import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, clearSessionCookie } from "@/lib/session";
import { getEventState } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      const res = NextResponse.json({ authenticated: false });
      clearSessionCookie(res);
      return res;
    }

    const state = await getEventState(true);
    const participant = state.participants.find((p) => p.id === session.participantId);

    // If participant has no registered PIN, the session is invalidated
    if (!participant || !participant.pinHash) {
      const res = NextResponse.json({ authenticated: false });
      clearSessionCookie(res);
      return res;
    }

    return NextResponse.json({
      authenticated: true,
      participant: {
        id: participant.id,
        name: participant.name,
        isRevealed: Boolean(participant.isRevealed),
      },
    });
  } catch {
    const res = NextResponse.json({ authenticated: false });
    clearSessionCookie(res);
    return res;
  }
}
