import { NextRequest, NextResponse } from "next/server";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  getParticipantBiometricStatus,
  registerParticipantBiometric,
  authenticateParticipantBiometric,
  bindDeviceToParticipant,
  getDeviceOrHardwareBinding,
  isValidPasskeyCredentialId,
} from "@/lib/storage";
import { getWebAuthnRpDetails } from "@/lib/admin-auth";
import {
  setSessionCookie,
  setDeviceCookie,
  getDeviceIdFromRequest,
  getHardwareFingerprintFromRequest,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "";
    const body = await req.json().catch(() => null);

    if (!body || !body.participantId || !body.response) {
      return NextResponse.json(
        { success: false, error: "Missing authentication payload." },
        { status: 400 }
      );
    }

    const { participantId, mode, response: clientResponse } = body;
    const deviceId = getDeviceIdFromRequest(req);
    const hwFp = getHardwareFingerprintFromRequest(req);
    const { rpID, origin } = getWebAuthnRpDetails(req);

    // Authoritative Device & Hardware Binding Check
    const existingBinding = await getDeviceOrHardwareBinding(deviceId, hwFp);
    if (existingBinding && existingBinding.participantId !== participantId) {
      return NextResponse.json(
        {
          success: false,
          error: `This device is officially registered to ${existingBinding.participantName}. Accessing other accounts from this device is not permitted.`,
        },
        { status: 403 }
      );
    }

    // Read unified or legacy challenge cookie
    const rawChallengeCookie =
      req.cookies.get("santa_biometric_challenge")?.value ||
      (mode === "register"
        ? req.cookies.get("santa_participant_reg_challenge")?.value
        : req.cookies.get("santa_participant_auth_challenge")?.value);

    if (!rawChallengeCookie) {
      return NextResponse.json(
        { success: false, error: "Authentication session expired. Please tap below to try again." },
        { status: 400 }
      );
    }

    // Strip prefix if present (e.g., 'auth:' or 'reg:')
    const expectedChallenge = rawChallengeCookie.includes(":")
      ? rawChallengeCookie.split(":")[1]
      : rawChallengeCookie;

    if (mode === "register") {
      // ----------------------------------------------------
      // REGISTRATION VERIFICATION
      // ----------------------------------------------------
      // Block duplicate registration if participant already has a registered passkey
      const existingStatus = await getParticipantBiometricStatus(participantId);
      if (existingStatus.hasPasskey) {
        return NextResponse.json(
          {
            success: false,
            error: "A biometric passkey is already registered for this participant. Duplicate registration is blocked.",
          },
          { status: 403 }
        );
      }

      const verification = await verifyRegistrationResponse({
        response: clientResponse,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return NextResponse.json(
          { success: false, error: "Biometric registration could not be verified." },
          { status: 400 }
        );
      }

      const { credential } = verification.registrationInfo;
      if (!isValidPasskeyCredentialId(credential.id)) {
        return NextResponse.json(
          { success: false, error: "Invalid credential ID received from device authenticator." },
          { status: 400 }
        );
      }

      const result = await registerParticipantBiometric(participantId, {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
      });

      if (!result.success || !result.participant) {
        return NextResponse.json(
          { success: false, error: result.error || "Failed to register credential." },
          { status: 400 }
        );
      }

      // Bind device authoritatively before returning
      await bindDeviceToParticipant(deviceId, participantId, result.participant.name, {
        ip,
        userAgent,
        hardwareFingerprint: hwFp || undefined,
      });

      const response = NextResponse.json({
        success: true,
        message: "Biometric authentication registered successfully.",
        participant: result.participant,
        recipientName: result.recipientName,
        isRevealed: Boolean(result.participant.isRevealed),
        deviceId,
        mode: "register",
      });

      // Clear challenge cookie
      response.cookies.set("santa_biometric_challenge", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });

      // Set session & device cookies
      setSessionCookie(response, participantId);
      setDeviceCookie(response, deviceId);

      return response;
    } else {
      // ----------------------------------------------------
      // AUTHENTICATION VERIFICATION
      // ----------------------------------------------------
      const status = await getParticipantBiometricStatus(participantId);
      if (!status.hasPasskey || !status.passkeyCredentialId || !status.passkeyPublicKey) {
        return NextResponse.json(
          { success: false, error: "No passkey registered for this participant." },
          { status: 404 }
        );
      }

      const verification = await verifyAuthenticationResponse({
        response: clientResponse,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: status.passkeyCredentialId,
          publicKey: Buffer.from(status.passkeyPublicKey, "base64url"),
          counter: status.passkeyCounter ?? 0,
        },
        requireUserVerification: true,
      });

      if (!verification.verified) {
        return NextResponse.json(
          { success: false, error: "Biometric authentication could not be verified." },
          { status: 400 }
        );
      }

      const newCounter = verification.authenticationInfo?.newCounter;
      const result = await authenticateParticipantBiometric(participantId, newCounter);
      if (!result.success || !result.participant) {
        return NextResponse.json(
          { success: false, error: result.error || "Authentication failed." },
          { status: 400 }
        );
      }

      // Bind device authoritatively before returning
      await bindDeviceToParticipant(deviceId, participantId, result.participant.name, {
        ip,
        userAgent,
        hardwareFingerprint: hwFp || undefined,
      });

      const response = NextResponse.json({
        success: true,
        message: "Biometric authentication successful.",
        participant: result.participant,
        recipientName: result.recipientName,
        isRevealed: Boolean(result.participant.isRevealed),
        deviceId,
        mode: "authenticate",
      });

      // Clear challenge cookie
      response.cookies.set("santa_biometric_challenge", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });

      // Set session & device cookies
      setSessionCookie(response, participantId);
      setDeviceCookie(response, deviceId);

      return response;
    }
  } catch (err: unknown) {
    console.error("Biometric verify error:", err);
    const message = err instanceof Error ? err.message : "Verification error.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
