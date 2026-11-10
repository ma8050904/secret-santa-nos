import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getAdminPasskeys } from "@/lib/storage";
import { getWebAuthnRpDetails } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const passkeys = await getAdminPasskeys();
    if (passkeys.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No passkeys have been registered yet. Please register your Touch ID / Face ID first.",
          noPasskeys: true,
        },
        { status: 404 }
      );
    }

    const { rpID } = getWebAuthnRpDetails(req);

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: passkeys.map((pk) => ({
        id: pk.id,
        // Strictly internal platform authenticator (Mac Touch ID) - prevents cross-device QR code modal
        transports: ["internal"] as any,
      })),
      userVerification: "required",
      timeout: 60000,
    });

    const response = NextResponse.json({ success: true, options });

    // Store auth challenge in short-lived secure HTTP-only cookie
    response.cookies.set("santa_passkey_auth_challenge", options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 300, // 5 minutes
    });

    return response;
  } catch (err: unknown) {
    console.error("Passkey auth options error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to generate passkey authentication options." },
      { status: 500 }
    );
  }
}
