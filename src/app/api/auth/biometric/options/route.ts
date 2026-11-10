import { NextRequest, NextResponse } from "next/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from "@simplewebauthn/server";
import { getParticipantBiometricStatus, getDeviceBinding } from "@/lib/storage";
import { getWebAuthnRpDetails } from "@/lib/admin-auth";
import { getDeviceIdFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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

    // 1. Authoritative Device-Level Binding Check
    const existingBinding = await getDeviceBinding(deviceId);
    if (existingBinding && existingBinding.participantId !== participantId) {
      return NextResponse.json(
        {
          success: false,
          error: `This device is officially registered to ${existingBinding.participantName}. Accessing other accounts from this device is not permitted.`,
        },
        { status: 403 }
      );
    }

    // 2. Query participant biometric status from storage
    const status = await getParticipantBiometricStatus(participantId);
    if (!status.name) {
      return NextResponse.json(
        { success: false, error: "Participant not found." },
        { status: 404 }
      );
    }

    const { rpID } = getWebAuthnRpDetails(req);

    // 3. Mode Selection: Authenticate (if passkey exists) or Register (first time)
    if (status.hasPasskey && status.passkeyCredentialId) {
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

      // Save challenge in secure HTTP-only cookie
      response.cookies.set("santa_biometric_challenge", `auth:${options.challenge}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 300,
      });

      return response;
    } else {
      // First-time registration
      const safeUserName = `${status.name.replace(/[^\w]/g, "").toLowerCase() || "student"}_${participantId.slice(0, 8)}@secretsanta.holiday`;

      const options = await generateRegistrationOptions({
        rpName: "Secret Santa 2024",
        rpID,
        userID: new TextEncoder().encode(participantId),
        userName: safeUserName,
        userDisplayName: status.name,
        attestationType: "none",
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

      // Save challenge in secure HTTP-only cookie
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
