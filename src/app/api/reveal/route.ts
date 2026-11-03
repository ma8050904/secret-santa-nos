import { NextRequest, NextResponse } from "next/server";
import { revealRecipientWithPin } from "@/lib/storage";
import { getSessionFromRequest } from "@/lib/session";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";

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
      return NextResponse.json({ success: false, error: "Personal PIN is required to open your gift" }, { status: 400 });
    }

    // Rate limiting key: combines client IP and participant ID
    const rateLimitKey = `reveal:${ip}:${participantId}`;
    const rateCheck = checkRateLimit(rateLimitKey);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many reveal attempts. Please wait ${rateCheck.retryAfterSec || 60} seconds.`,
        },
        { status: 429 }
      );
    }

    // Verify session lock: bound strictly to authenticated participant
    const session = getSessionFromRequest(req);
    if (session && session.participantId !== participantId) {
      return NextResponse.json(
        { success: false, error: "Access denied. This session is locked to another participant." },
        { status: 403 }
      );
    }

    const result = await revealRecipientWithPin(participantId, pin.trim());

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Authentication failed",
        },
        { status: 401 }
      );
    }

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
