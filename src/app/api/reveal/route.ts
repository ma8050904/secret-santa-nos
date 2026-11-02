import { NextRequest, NextResponse } from "next/server";
import { revealRecipientForParticipant } from "@/lib/storage";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Malformed request payload" }, { status: 400 });
    }

    const { participantId, passcode } = body;

    if (!participantId || typeof participantId !== "string") {
      return NextResponse.json({ success: false, error: "Participant ID is required" }, { status: 400 });
    }

    if (!passcode || typeof passcode !== "string" || passcode.trim().length === 0) {
      return NextResponse.json({ success: false, error: "Christmas Secret Code is required" }, { status: 400 });
    }

    // Rate limiting key: combines client IP and participant ID
    const rateLimitKey = `${ip}:${participantId}`;
    const rateCheck = checkRateLimit(rateLimitKey);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many unsuccessful attempts. Please wait ${rateCheck.retryAfterSec || 60} seconds before trying again.`,
        },
        { status: 429 }
      );
    }

    const result = await revealRecipientForParticipant(participantId, passcode);

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

    // Authentication successful: reset rate limiter
    resetRateLimit(rateLimitKey);

    return NextResponse.json({
      success: true,
      recipientName: result.recipientName,
      isFirstReveal: result.isFirstReveal,
    });
  } catch (err: unknown) {
    console.error("Reveal API error:", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred while opening your gift." },
      { status: 500 }
    );
  }
}
