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
  setBoundParticipantCookie,
  getSessionFromRequest,
  getDeviceIdFromRequest,
  getHardwareFingerprintFromRequest,
  getBoundParticipantFromRequest,
  verifyBiometricChallengeCookie,
} from "@/lib/session";
import { getPasskeyCredentialOwner } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function handleBiometricVerify(
  req: NextRequest,
  forcedMode?: "register" | "authenticate"
) {
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
    const effectiveMode = forcedMode || mode;
    const deviceId = getDeviceIdFromRequest(req);
    const hwFp = getHardwareFingerprintFromRequest(req);
    const { rpID, origin } = getWebAuthnRpDetails(req);

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

    // 2. Authoritative Database Device & Hardware Binding Check (Layer 1)
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

    // 3. Session Lock: Prevent switching participant identity within an existing authenticated session
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

    // Read signed challenge cookie or legacy challenge cookie
    const signedChallenge = verifyBiometricChallengeCookie(req, effectiveMode, participantId);
    const rawChallengeCookie =
      signedChallenge ||
      req.cookies.get("santa_biometric_challenge")?.value ||
      (effectiveMode === "register"
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

    if (effectiveMode === "register") {
      // ----------------------------------------------------
      // REGISTRATION VERIFICATION
      // ----------------------------------------------------
      // Section 1.1: Block registration if participant is ALREADY CLAIMED
      const existingStatus = await getParticipantBiometricStatus(participantId);
      if (existingStatus.isClaimed) {
        return NextResponse.json(
          {
            success: false,
            error: "This participant profile has already been claimed and locked. WebAuthn registration is strictly prohibited.",
          },
          { status: 403 }
        );
      }

      // Check if credential ID already belongs to another participant
      if (clientResponse.id) {
        const owner = await getPasskeyCredentialOwner(clientResponse.id);
        if (owner && owner.participantId !== participantId) {
          const res = NextResponse.json(
            {
              success: false,
              error: `هذا الجهاز مرتبط مسبقاً بحساب ${owner.participantName}، لا يمكنك فتح أو تسجيل اسم آخر`,
              boundParticipantId: owner.participantId,
              boundParticipantName: owner.participantName,
              code: "DEVICE_ALREADY_BOUND",
            },
            { status: 403 }
          );
          setBoundParticipantCookie(res, owner.participantId);
          return res;
        }
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
        const isReuse = result.error?.toLowerCase().includes("cross-participant") || result.error?.toLowerCase().includes("already registered");
        return NextResponse.json(
          { success: false, error: result.error || "Failed to register credential." },
          { status: isReuse ? 403 : 400 }
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

      // Set session, device & bound participant cookies (Layer 2)
      setSessionCookie(response, participantId, deviceId);
      setDeviceCookie(response, deviceId);
      setBoundParticipantCookie(response, participantId);

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

      // Cross-Participant Isolation Gate:
      // If client attempts to authenticate using a credential ID that does not belong to this participant, reject with HTTP 403
      if (clientResponse.id) {
        const owner = await getPasskeyCredentialOwner(clientResponse.id);
        if (owner && owner.participantId !== participantId) {
          const res = NextResponse.json(
            {
              success: false,
              error: `هذا الجهاز مرتبط مسبقاً بحساب ${owner.participantName}، لا يمكنك فتح أو تسجيل اسم آخر`,
              boundParticipantId: owner.participantId,
              boundParticipantName: owner.participantName,
              code: "DEVICE_ALREADY_BOUND",
            },
            { status: 403 }
          );
          setBoundParticipantCookie(res, owner.participantId);
          return res;
        }
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

      // Set session, device & bound participant cookies (Layer 2)
      setSessionCookie(response, participantId, deviceId);
      setDeviceCookie(response, deviceId);
      setBoundParticipantCookie(response, participantId);

      return response;
    }
  } catch (err: unknown) {
    console.error("Biometric verify error:", err);
    const message = err instanceof Error ? err.message : "Verification error.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  return handleBiometricVerify(req);
}
