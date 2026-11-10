import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getDeviceIdFromRequest } from "@/lib/session";
import { clearDeviceBinding } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    const deviceId = getDeviceIdFromRequest(req);
    if (deviceId) {
      await clearDeviceBinding(deviceId);
    }
  } catch {
    // ignore
  }

  const response = NextResponse.json({
    success: true,
    message: "Logged out and device unlinked successfully",
  });

  clearSessionCookie(response);

  // Clear device cookie
  response.cookies.set("santa_device_v7_clean", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
