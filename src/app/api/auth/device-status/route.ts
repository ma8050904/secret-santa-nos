import { NextRequest, NextResponse } from "next/server";
import { getDeviceOrHardwareBinding } from "@/lib/storage";
import { getDeviceIdFromRequest, getHardwareFingerprintFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const deviceId = getDeviceIdFromRequest(req);
    const hwFp = getHardwareFingerprintFromRequest(req);
    const binding = await getDeviceOrHardwareBinding(deviceId, hwFp);

    if (binding) {
      return NextResponse.json({
        bound: true,
        participantId: binding.participantId,
        participantName: binding.participantName,
      });
    }

    return NextResponse.json({
      bound: false,
    });
  } catch (err: unknown) {
    console.error("Device status check error:", err);
    return NextResponse.json({ bound: false });
  }
}
