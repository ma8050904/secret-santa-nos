import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, getDeviceIdFromRequest, clearSessionCookie } from "@/lib/session";
import { getEventState, getDeviceBinding } from "@/lib/storage";

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

    // Authoritative Device-Binding Check:
    // If the organizer reset device bindings, invalidate active sessions on this device immediately
    const deviceId = getDeviceIdFromRequest(req);
    const binding = await getDeviceBinding(deviceId);
    if (!binding || binding.participantId !== session.participantId) {
      const res = NextResponse.json({ authenticated: false, unbound: true });
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
