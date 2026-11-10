import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { saveAdminPasskey, getAdminPasskeys, recordAdminAuditLog } from "@/lib/storage";
import { getWebAuthnRpDetails, setAdminSessionCookie } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.response) {
      return NextResponse.json({ success: false, error: "Missing registration response." }, { status: 400 });
    }

    const expectedChallenge = req.cookies.get("santa_passkey_reg_challenge")?.value;
    if (!expectedChallenge) {
      return NextResponse.json(
        { success: false, error: "Registration session expired. Please try again." },
        { status: 400 }
      );
    }

    const { rpID, origin } = getWebAuthnRpDetails(req);

    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ success: false, error: "Biometric passkey verification failed." }, { status: 400 });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    const passkeyRecord = {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      // Strictly internal platform authenticator (Mac Touch ID) - prevents cross-device QR modal
      transports: ["internal"],
      deviceType: credentialDeviceType || "platform",
      backedUp: Boolean(credentialBackedUp),
      createdAt: new Date().toISOString(),
      label: body.label || (credentialDeviceType === "multiDevice" ? "iCloud Keychain (Touch ID / Face ID)" : "Mac Touch ID"),
    };

    await saveAdminPasskey(passkeyRecord);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    await recordAdminAuditLog({
      action: "REGISTER_PASSKEY",
      actionLabel: "Register Admin Passkey",
      ip,
      status: "SUCCESS",
      details: `New biometric passkey registered (${passkeyRecord.label}, ID: ${passkeyRecord.id.slice(0, 10)}...).`,
    });

    const response = NextResponse.json({
      success: true,
      message: "Passkey registered successfully. You can now log in using Touch ID / Face ID.",
      passkey: {
        id: passkeyRecord.id,
        label: passkeyRecord.label,
        createdAt: passkeyRecord.createdAt,
      },
    });

    // Clear registration challenge cookie
    response.cookies.set("santa_passkey_reg_challenge", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    // Establish admin session immediately
    setAdminSessionCookie(response);

    return response;
  } catch (err: unknown) {
    console.error("Passkey register verify error:", err);
    const message = err instanceof Error ? err.message : "Registration verification failed.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
