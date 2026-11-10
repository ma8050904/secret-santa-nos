import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getParticipantBiometricStatus, getDeviceBinding } from "@/lib/storage";
import { getWebAuthnRpDetails } from "@/lib/admin-auth";
import { getDeviceIdFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.participantId !== "string") {
      return NextResponse.json({ success: false, error: "Participant ID is required" }, { status: 400 });
    }

    const { participantId } = body;
    const deviceId = getDeviceIdFromRequest(req);

    // 1. Authoritative Device-Level Binding Check
    const existingBinding = await getDeviceBinding(deviceId);
    if (existingBinding && existingBinding.participantId !== participantId) {
      return NextResponse.json(
        {
          success: false,
          error: `This device is officially registered to ${existingBinding.participantName}. Accessing other participant accounts from this device is not permitted.`,
        },
        { status: 403 }
      );
    }

    // 2. Check participant status
    const status = await getParticipantBiometricStatus(participantId);
    if (!status.name) {
      return NextResponse.json({ success: false, error: "Participant not found." }, { status: 404 });
    }

    const { rpID } = getWebAuthnRpDetails(req);
    const safeUserName = `${status.name.replace(/[^\w]/g, "").toLowerCase() || "student"}_${participantId.slice(0, 8)}@secretsanta.holiday`;

    const options = await generateRegistrationOptions({
      rpName: "Secret Santa 2024",
      rpID,
      userID: new TextEncoder().encode(participantId),
      userName: safeUserName,
      userDisplayName: status.name,
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform", // Native Face ID / Touch ID / Device Passcode
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
    });

    const response = NextResponse.json({ success: true, options });

    // Store challenge in secure HTTP-only cookie
    response.cookies.set("santa_participant_reg_challenge", options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 300, // 5 minutes
    });

    return response;
  } catch (err: unknown) {
    console.error("Biometric register options error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to generate biometric registration options." },
      { status: 500 }
    );
  }
}
