import { NextRequest, NextResponse } from "next/server";
import { getDeviceBinding } from "@/lib/storage";
import { getDeviceIdFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const deviceId = getDeviceIdFromRequest(req);
    const binding = await getDeviceBinding(deviceId);

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
