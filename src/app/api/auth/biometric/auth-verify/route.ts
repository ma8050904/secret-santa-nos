import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getParticipantBiometricStatus, authenticateParticipantBiometric, bindDeviceToParticipant } from "@/lib/storage";
import { getWebAuthnRpDetails } from "@/lib/admin-auth";
import { setSessionCookie, setDeviceCookie, getDeviceIdFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "";
    const body = await req.json().catch(() => null);

    if (!body || !body.participantId || !body.response) {
      return NextResponse.json({ success: false, error: "Missing authentication payload." }, { status: 400 });
    }

    const { participantId, response: authResponse } = body;
    const expectedChallenge = req.cookies.get("santa_participant_auth_challenge")?.value;

    if (!expectedChallenge) {
      return NextResponse.json(
        { success: false, error: "Authentication session expired. Please try again." },
        { status: 400 }
      );
    }

    const status = await getParticipantBiometricStatus(participantId);
    if (!status.hasPasskey || !status.passkeyCredentialId || !status.passkeyPublicKey) {
      return NextResponse.json(
        { success: false, error: "No biometric passkey registered for this participant." },
        { status: 404 }
      );
    }

    const { rpID, origin } = getWebAuthnRpDetails(req);
    const deviceId = getDeviceIdFromRequest(req);

    const verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: status.passkeyCredentialId,
        publicKey: Buffer.from(status.passkeyPublicKey, "base64url"),
        counter: 0,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return NextResponse.json(
        { success: false, error: "Biometric authentication could not be verified." },
        { status: 400 }
      );
    }

    const result = await authenticateParticipantBiometric(participantId);
    if (!result.success || !result.participant) {
      return NextResponse.json(
        { success: false, error: result.error || "Authentication failed." },
        { status: 400 }
      );
    }

    // Refresh device binding in background
    bindDeviceToParticipant(deviceId, participantId, result.participant.name, {
      ip,
      userAgent,
    }).catch((err) => console.warn("Background device binding notice:", err));

    const response = NextResponse.json({
      success: true,
      message: "Biometric authentication successful.",
      participant: result.participant,
      recipientName: result.recipientName,
      deviceId,
    });

    // Clear challenge cookie
    response.cookies.set("santa_participant_auth_challenge", "", {
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
    console.error("Biometric auth verify error:", err);
    const message = err instanceof Error ? err.message : "Authentication verification failed.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
