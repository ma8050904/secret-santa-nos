import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

/**
 * Participant session termination.
 * NOTE: Per strict security policy, device bindings are PERMANENT and CANNOT
 * be unlinked by participants. Only the organizer can reset device locks.
 */
export async function POST() {
  const response = NextResponse.json({
    success: true,
    message: "Session ended. Device remains bound to participant account.",
  });

  clearSessionCookie(response);

  return response;
}
