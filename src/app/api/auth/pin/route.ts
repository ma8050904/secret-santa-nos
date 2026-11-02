import { NextRequest, NextResponse } from "next/server";
import { authenticateOrRegisterPin } from "@/lib/storage";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { setSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Malformed request payload" }, { status: 400 });
    }

    const { participantId, pin } = body;

    if (!participantId || typeof participantId !== "string") {
      return NextResponse.json({ success: false, error: "Participant ID is required" }, { status: 400 });
    }

    if (!pin || typeof pin !== "string" || pin.trim().length === 0) {
      return NextResponse.json({ success: false, error: "PIN is required" }, { status: 400 });
    }

    // Rate limiting key: combines client IP and participant ID
    const rateLimitKey = `${ip}:${participantId}`;
    const rateCheck = checkRateLimit(rateLimitKey);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many unsuccessful attempts. For security, please wait ${rateCheck.retryAfterSec || 60} seconds before trying again.`,
          remainingAttempts: 0,
        },
        { status: 429 }
      );
    }

    const result = await authenticateOrRegisterPin(participantId, pin);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Authentication failed",
          remainingAttempts: rateCheck.remainingAttempts,
        },
        { status: 401 }
      );
    }

    // Successful authentication / registration: reset rate limiter
    resetRateLimit(rateLimitKey);

    const response = NextResponse.json({
      success: true,
      isNewRegistration: result.isNewRegistration,
      participant: result.participant,
      recipientName: result.recipientName,
    });

    // Establish secure session cookie
    setSessionCookie(response, participantId);

    return response;
  } catch (err: unknown) {
    console.error("PIN Auth error:", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred during verification." },
      { status: 500 }
    );
  }
}
