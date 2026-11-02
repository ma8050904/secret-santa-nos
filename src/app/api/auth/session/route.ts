import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getEventState } from "@/lib/storage";

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ authenticated: false });
    }

    const state = await getEventState();
    const participant = state.participants.find((p) => p.id === session.participantId);

    if (!participant) {
      return NextResponse.json({ authenticated: false });
    }

    return NextResponse.json({
      authenticated: true,
      participant: {
        id: participant.id,
        name: participant.name,
        isRevealed: participant.isRevealed,
      },
    });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}
