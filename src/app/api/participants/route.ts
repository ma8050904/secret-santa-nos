import { NextResponse } from "next/server";
import { getEventState } from "@/lib/storage";
import { PARTICIPANTS } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * Public participant directory endpoint.
 * Returns only safe visual attributes: id, name, isRevealed flag.
 * Zero confidential data or access codes.
 */
export async function GET() {
  try {
    const state = await getEventState(true);

    const publicParticipants = state.participants.map((p) => ({
      id: p.id,
      name: p.name,
      isRevealed: Boolean(p.isRevealed),
      hasRegistered: Boolean(p.pinHash || p.passkeyCredentialId),
      hasPasskey: Boolean(p.passkeyCredentialId),
    }));

    return NextResponse.json(
      {
        success: true,
        eventStatus: state.status,
        participants: publicParticipants,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (err: unknown) {
    console.error("Warning: Storage read notice in /api/participants, using resilient fallback:", err);
    // Never fail the entire website with 500: return standard participants list gracefully
    return NextResponse.json(
      {
        success: true,
        eventStatus: "active",
        participants: PARTICIPANTS.map((p) => ({
          id: p.id,
          name: p.name,
          isRevealed: false,
        })),
        degraded: true,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
