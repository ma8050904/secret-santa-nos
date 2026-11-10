import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { registerParticipantBiometric, bindDeviceToParticipant } from "@/lib/storage";
import { getWebAuthnRpDetails } from "@/lib/admin-auth";
import { setSessionCookie, setDeviceCookie, getDeviceIdFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "";
    const body = await req.json().catch(() => null);

    if (!body || !body.participantId || !body.response) {
      return NextResponse.json({ success: false, error: "Missing registration payload." }, { status: 400 });
    }

    const { participantId, response: regResponse } = body;
    const expectedChallenge = req.cookies.get("santa_participant_reg_challenge")?.value;

    if (!expectedChallenge) {
      return NextResponse.json(
        { success: false, error: "Registration session expired. Please try again." },
        { status: 400 }
      );
    }

    const { rpID, origin } = getWebAuthnRpDetails(req);
    const deviceId = getDeviceIdFromRequest(req);

    const verification = await verifyRegistrationResponse({
      response: regResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json(
        { success: false, error: "Biometric authentication verification failed." },
        { status: 400 }
      );
    }

    const { credential } = verification.registrationInfo;

    const result = await registerParticipantBiometric(participantId, {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
    });

    if (!result.success || !result.participant) {
      return NextResponse.json({ success: false, error: result.error || "Failed to register credential." }, { status: 400 });
    }

    // Authoritatively bind this hardware device to the participant
    await bindDeviceToParticipant(deviceId, participantId, result.participant.name, { ip, userAgent });

    const response = NextResponse.json({
      success: true,
      message: "Biometric authentication registered successfully.",
      participant: result.participant,
      recipientName: result.recipientName,
      deviceId,
    });

    // Clear challenge cookie
    response.cookies.set("santa_participant_reg_challenge", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    // Establish persistent session and device cookies
    setSessionCookie(response, participantId);
    setDeviceCookie(response, deviceId);

    return response;
  } catch (err: unknown) {
    console.error("Biometric register verify error:", err);
    const message = err instanceof Error ? err.message : "Registration verification failed.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
