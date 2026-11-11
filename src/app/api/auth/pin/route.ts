import { NextRequest, NextResponse } from "next/server";
import { authenticateOrRegisterPin, getDeviceOrHardwareBinding, bindDeviceToParticipant } from "@/lib/storage";
import { checkDistributedRateLimit, resetDistributedRateLimit } from "@/lib/db";
import {
  setSessionCookie,
  setDeviceCookie,
  setBoundParticipantCookie,
  getSessionFromRequest,
  getDeviceIdFromRequest,
  getHardwareFingerprintFromRequest,
  getBoundParticipantFromRequest,
} from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "127.0.0.1";
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

    // Extract device identifier and hardware fingerprint from request headers or cookie
    const deviceId = getDeviceIdFromRequest(req);
    const hwFp = getHardwareFingerprintFromRequest(req);

    // Rate limiting key: combines client IP and participant ID
    const rateLimitKey = `${ip}:${participantId}`;
    const rateCheck = await checkDistributedRateLimit(rateLimitKey);

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

    // 1. Signed Cookie Binding Check (Layer 2)
    const boundParticipantId = getBoundParticipantFromRequest(req);
    if (boundParticipantId && boundParticipantId.toLowerCase() !== participantId.toLowerCase()) {
      return NextResponse.json(
        {
          success: false,
          error: `This device is permanently bound to another participant. Accessing other accounts is not permitted.`,
        },
        { status: 403 }
      );
    }

    // 2. Authoritative Device-Level and Hardware Binding Check (Layer 1)
    // Works across Normal, Private, and Incognito browsing windows
    const existingDeviceBinding = await getDeviceOrHardwareBinding(deviceId, hwFp);
    if (existingDeviceBinding && existingDeviceBinding.participantId !== participantId) {
      return NextResponse.json(
        {
          success: false,
          error: `This device is officially registered to ${existingDeviceBinding.participantName}. Accessing other participant accounts from this device is not permitted.`,
          boundParticipantName: existingDeviceBinding.participantName,
          boundParticipantId: existingDeviceBinding.participantId,
        },
        { status: 403 }
      );
    }

    // 3. Prevent switching participant identity within an existing authenticated session (Session Lock)
    const existingSession = getSessionFromRequest(req);
    if (existingSession && existingSession.participantId !== participantId) {
      return NextResponse.json(
        {
          success: false,
          error: "This session is locked to an authenticated participant account. Switching participants is not permitted.",
        },
        { status: 403 }
      );
    }

    const result = await authenticateOrRegisterPin(participantId, pin);

    if (!result.success) {
      const isClaimedOrLocked =
        result.error?.toLowerCase().includes("already been claimed") ||
        result.error?.toLowerCase().includes("prohibited");
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Authentication failed",
          remainingAttempts: rateCheck.remainingAttempts,
        },
        { status: isClaimedOrLocked ? 403 : 401 }
      );
    }

    const userAgent = req.headers.get("user-agent") || "";

    // Bind this device and hardware fingerprint to the authenticated participant authoritatively
    await bindDeviceToParticipant(deviceId, participantId, result.participant?.name || "", {
      ip,
      userAgent,
      hardwareFingerprint: hwFp || undefined,
    });

    // Successful authentication / registration: reset rate limiter
    await resetDistributedRateLimit(rateLimitKey);

    const response = NextResponse.json({
      success: true,
      isNewRegistration: result.isNewRegistration,
      participant: result.participant,
      recipientName: result.recipientName,
      deviceId,
    });

    // Establish secure session cookie, persistent device cookie & bound participant cookie
    setSessionCookie(response, participantId, deviceId);
    setDeviceCookie(response, deviceId);
    setBoundParticipantCookie(response, participantId);

    return response;
  } catch (err: unknown) {
    console.error("PIN Auth error:", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred during verification." },
      { status: 500 }
    );
  }
}
