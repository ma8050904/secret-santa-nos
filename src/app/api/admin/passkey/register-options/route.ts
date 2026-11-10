import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getAdminPasskeys } from "@/lib/storage";
import { getWebAuthnRpDetails, verifyAdminRequest, verifyAdminPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const existingPasskeys = await getAdminPasskeys();
    const isAuthed = await verifyAdminRequest(req);

    const authHeader = req.headers.get("x-admin-password") || req.headers.get("authorization");
    let hasValidPassword = false;
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "");
      hasValidPassword = await verifyAdminPassword(token);
    }

    if (existingPasskeys.length > 0 && !isAuthed && !hasValidPassword) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Admin authentication required to register passkeys." },
        { status: 401 }
      );
    }

    const { rpID } = getWebAuthnRpDetails(req);

    const options = await generateRegistrationOptions({
      rpName: "Secret Santa Organizer",
      rpID,
      userID: new TextEncoder().encode("admin_organizer_id"),
      userName: "admin@secretsanta.holiday",
      userDisplayName: "Secret Santa Organizer",
      attestationType: "none",
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.id,
        transports: pk.transports as any,
      })),
      authenticatorSelection: {
        authenticatorAttachment: "platform", // Apple Touch ID / Face ID / Windows Hello
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
    });

    const response = NextResponse.json({ success: true, options });

    // Store challenge in short-lived secure HTTP-only cookie
    response.cookies.set("santa_passkey_reg_challenge", options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 300, // 5 minutes
    });

    return response;
  } catch (err: unknown) {
    console.error("Passkey register options error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to generate passkey registration options." },
      { status: 500 }
    );
  }
}
