import { NextResponse } from "next/server";
import { getEventState } from "@/lib/storage";

/**
 * Public participant directory endpoint.
 * Returns only safe visual attributes: id, name, isRevealed flag.
 * Zero confidential data or access codes.
 */
export async function GET() {
  try {
    const state = await getEventState();

    const publicParticipants = state.participants.map((p) => ({
      id: p.id,
      name: p.name,
      isRevealed: p.isRevealed,
    }));

    return NextResponse.json({
      success: true,
      eventStatus: state.status,
      participants: publicParticipants,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
