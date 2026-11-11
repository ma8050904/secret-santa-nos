import { NextRequest, NextResponse } from "next/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from "@simplewebauthn/server";
import {
  getParticipantBiometricStatus,
  getDeviceOrHardwareBinding,
  getAllRegisteredPasskeyCredentials,
  isValidPasskeyCredentialId,
} from "@/lib/storage";
import { getWebAuthnRpDetails } from "@/lib/admin-auth";
import {
  getDeviceIdFromRequest,
  getHardwareFingerprintFromRequest,
  getSessionFromRequest,
  getBoundParticipantFromRequest,
  setBiometricChallengeCookie,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function handleBiometricOptions(
  req: NextRequest,
  forcedMode?: "register" | "authenticate"
) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.participantId !== "string") {
      return NextResponse.json(
        { success: false, error: "Participant ID is required" },
        { status: 400 }
      );
    }

    const { participantId } = body;
    const deviceId = getDeviceIdFromRequest(req);
    const hwFp = getHardwareFingerprintFromRequest(req);

    // 1. Signed Cookie Binding Check (Layer 2)
    const boundParticipantId = getBoundParticipantFromRequest(req);
    if (boundParticipantId && boundParticipantId.toLowerCase() !== participantId.toLowerCase()) {
      return NextResponse.json(
        {
          success: false,
          error: `This device is permanently bound to another participant. Accessing other accounts is not permitted.`,
          boundParticipantId,
        },
        { status: 403 }
      );
    }

    // 2. Authoritative Database Device & Hardware Binding Check (Layer 1)
    // Works across Normal, Private, and Incognito browsing windows
    const existingBinding = await getDeviceOrHardwareBinding(deviceId, hwFp);
    if (existingBinding && existingBinding.participantId !== participantId) {
      return NextResponse.json(
        {
          success: false,
          error: `This device is officially registered to ${existingBinding.participantName}. Accessing other accounts from this device is not permitted.`,
          boundParticipantName: existingBinding.participantName,
          boundParticipantId: existingBinding.participantId,
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

    // 4. Query participant biometric status from storage
    const status = await getParticipantBiometricStatus(participantId);
    if (!status.name) {
      return NextResponse.json(
        { success: false, error: "Participant not found." },
        { status: 404 }
      );
    }

    // Section 1.1: If participant is already claimed or revealed, WebAuthn Registration is strictly forbidden
    if (forcedMode === "register" && (status.isClaimed || status.isRevealed)) {
      return NextResponse.json(
        {
          success: false,
          error: "This participant profile has already been claimed and locked. WebAuthn registration is strictly prohibited.",
        },
        { status: 403 }
      );
    }

    const { rpID } = getWebAuthnRpDetails(req);
    const BASE64URL_REGEX = /^[A-Za-z0-9_-]{16,}$/;

    // 5. Mode Selection: Authenticate (if valid passkey exists and not forced register) or Register (first time only)
    const shouldAuthenticate = forcedMode ? forcedMode === "authenticate" : status.hasPasskey;

    if (shouldAuthenticate) {
      if (!status.hasPasskey) {
        return NextResponse.json(
          {
            success: false,
            error: "This participant profile is secured with a PIN. Please sign in with your PIN.",
            requiresPin: true,
          },
          { status: 400 }
        );
      }

      if (isValidPasskeyCredentialId(status.passkeyCredentialId)) {
        const options = await generateAuthenticationOptions({
          rpID,
          allowCredentials: [
            {
              id: status.passkeyCredentialId,
            },
          ],
          userVerification: "required",
          timeout: 30000,
        });

        const response = NextResponse.json({
          success: true,
          mode: "authenticate" as const,
          options,
        });

        // Save signed challenge in secure HTTP-only cookie
        setBiometricChallengeCookie(response, "authenticate", options.challenge, participantId);
        response.cookies.set("santa_biometric_challenge", `auth:${options.challenge}`, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 300,
        });

        return response;
      } else {
        return NextResponse.json(
          {
            success: false,
            error: "Biometric credential requires PIN recovery. Please enter your 4-digit PIN.",
            requiresPinRecovery: true,
          },
          { status: 403 }
        );
      }
    } else {
      // First-time registration with Silicon-level Hardware Exclusion
      // Section 1.1: Confirm participant is not claimed via PIN either or already revealed
      if (status.isClaimed || status.isRevealed) {
        return NextResponse.json(
          {
            success: false,
            error: "This participant profile has already been claimed and locked. New passkey registration is prohibited.",
          },
          { status: 403 }
        );
      }

      const { getPostgresAllPasskeyCredentialIds } = await import("@/lib/db");
      const pgCredentials = await getPostgresAllPasskeyCredentialIds();
      const allCredentials = await getAllRegisteredPasskeyCredentials();
      const combined = Array.from(new Set([...pgCredentials, ...allCredentials]));
      const validCredentials = combined.filter((id) => isValidPasskeyCredentialId(id));
      const safeUserName = `${status.name.replace(/[^\w]/g, "").toLowerCase() || "student"}_${participantId.slice(0, 8)}@secretsanta.holiday`;

      const options = await generateRegistrationOptions({
        rpName: "Secret Santa 2024",
        rpID,
        userID: new TextEncoder().encode(participantId),
        userName: safeUserName,
        userDisplayName: status.name,
        attestationType: "none",
        excludeCredentials: validCredentials.map((id) => ({
          id,
          type: "public-key",
        })),
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 30000,
      });

      const response = NextResponse.json({
        success: true,
        mode: "register" as const,
        options,
      });

      // Save signed challenge in secure HTTP-only cookie
      setBiometricChallengeCookie(response, "register", options.challenge, participantId);
      response.cookies.set("santa_biometric_challenge", `reg:${options.challenge}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 300,
      });

      return response;
    }
  } catch (err: unknown) {
    console.error("Biometric options error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to initialize biometric check." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handleBiometricOptions(req);
}
