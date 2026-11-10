import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getAdminPasskeys, updateAdminPasskeyCounter, recordAdminAuditLog } from "@/lib/storage";
import { getWebAuthnRpDetails, setAdminSessionCookie } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.response) {
      return NextResponse.json({ success: false, error: "Missing authentication response." }, { status: 400 });
    }

    const expectedChallenge = req.cookies.get("santa_passkey_auth_challenge")?.value;
    if (!expectedChallenge) {
      return NextResponse.json(
        { success: false, error: "Authentication session expired. Please try again." },
        { status: 400 }
      );
    }

    const credentialId = body.response.id;
    const passkeys = await getAdminPasskeys();
    const passkey = passkeys.find((pk) => pk.id === credentialId);

    if (!passkey) {
      return NextResponse.json(
        { success: false, error: "Passkey credential not recognized on this server." },
        { status: 400 }
      );
    }

    const { rpID, origin } = getWebAuthnRpDetails(req);

    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")),
        counter: passkey.counter,
        transports: passkey.transports as any,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return NextResponse.json({ success: false, error: "Biometric passkey assertion failed." }, { status: 401 });
    }

    // Update counter to protect against replay attacks
    await updateAdminPasskeyCounter(passkey.id, verification.authenticationInfo.newCounter);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    await recordAdminAuditLog({
      action: "AUTH_PASSKEY_LOGIN",
      actionLabel: "Passkey Biometric Login",
      ip,
      status: "SUCCESS",
      details: `Admin authenticated via biometric passkey (${passkey.label}).`,
    });

    const response = NextResponse.json({
      success: true,
      message: "Biometric authentication successful.",
    });

    // Clear challenge cookie
    response.cookies.set("santa_passkey_auth_challenge", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    // Establish admin session
    setAdminSessionCookie(response);

    return response;
  } catch (err: unknown) {
    console.error("Passkey auth verify error:", err);
    const message = err instanceof Error ? err.message : "Authentication verification failed.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
