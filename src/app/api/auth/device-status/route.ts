import { NextRequest, NextResponse } from "next/server";
import { getDeviceOrHardwareBinding } from "@/lib/storage";
import { PARTICIPANTS } from "@/lib/constants";
import {
  getDeviceIdFromRequest,
  getHardwareFingerprintFromRequest,
  getBoundParticipantFromRequest,
  setBoundParticipantCookie,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // 1. Check Signed HttpOnly Cookie (Layer 2)
    const boundParticipantId = getBoundParticipantFromRequest(req);
    if (boundParticipantId) {
      const part = PARTICIPANTS.find((p) => p.id === boundParticipantId);
      return NextResponse.json({
        bound: true,
        participantId: boundParticipantId,
        participantName: part?.name || boundParticipantId,
      });
    }

    // 2. Check Database Device and Hardware Fingerprint Binding (Layer 1)
    // Matches across Private/Incognito windows on the same physical device
    const deviceId = getDeviceIdFromRequest(req);
    const hwFp = getHardwareFingerprintFromRequest(req);
    const binding = await getDeviceOrHardwareBinding(deviceId, hwFp);

    if (binding) {
      const response = NextResponse.json({
        bound: true,
        participantId: binding.participantId,
        participantName: binding.participantName,
      });
      // Refresh the signed HttpOnly cookie so subsequent requests have Layer 2 binding
      setBoundParticipantCookie(response, binding.participantId);
      return response;
    }

    return NextResponse.json({
      bound: false,
    });
  } catch (err: unknown) {
    console.error("Device status check error:", err);
    return NextResponse.json({ bound: false });
  }
}
