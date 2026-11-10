import { NextRequest, NextResponse } from "next/server";
import { revealRecipientWithPin, revealRecipientWithBiometric, getDeviceBinding, recordDeviceReveal } from "@/lib/storage";
import { getSessionFromRequest, getDeviceIdFromRequest } from "@/lib/session";
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

    // Extract device identifier
    const deviceId = getDeviceIdFromRequest(req);

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

    // 1. Authoritative Device-Level Binding Check
    const deviceBinding = await getDeviceBinding(deviceId);
    if (deviceBinding && deviceBinding.participantId !== participantId) {
      return NextResponse.json(
        {
          success: false,
          error: `Access denied. This device is registered to ${deviceBinding.participantName}.`,
        },
        { status: 403 }
      );
    }

    // 2. Verify session lock: bound strictly to authenticated participant
    const session = getSessionFromRequest(req);
    if (session && session.participantId !== participantId) {
      return NextResponse.json(
        { success: false, error: "Access denied. This session is locked to another participant." },
        { status: 403 }
      );
    }

    let result;
    if (pin && typeof pin === "string" && pin.trim().length > 0) {
      result = await revealRecipientWithPin(participantId, pin.trim());
    } else {
      // Biometric or Session-authenticated reveal
      if (!session || session.participantId !== participantId) {
        return NextResponse.json(
          { success: false, error: "Authentication or PIN is required to open your gift." },
          { status: 401 }
        );
      }
      result = await revealRecipientWithBiometric(participantId);
    }

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

    const userAgent = req.headers.get("user-agent") || "";
    await recordDeviceReveal(deviceId, participantId, { ip, userAgent });

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
