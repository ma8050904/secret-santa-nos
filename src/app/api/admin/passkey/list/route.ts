import { NextRequest, NextResponse } from "next/server";
import { getAdminPasskeys } from "@/lib/storage";
import { verifyAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const passkeys = await getAdminPasskeys();
    const isAuthed = await verifyAdminRequest(req);

    if (!isAuthed) {
      // Unauthenticated caller: return minimal status (hasPasskeys boolean only)
      return NextResponse.json({
        success: true,
        hasPasskeys: passkeys.length > 0,
        count: passkeys.length,
      });
    }

    // Authenticated admin: return passkey list for settings management
    return NextResponse.json({
      success: true,
      hasPasskeys: passkeys.length > 0,
      count: passkeys.length,
      passkeys: passkeys.map((pk) => ({
        id: pk.id,
        label: pk.label,
        createdAt: pk.createdAt,
        deviceType: pk.deviceType,
      })),
    });
  } catch (err: unknown) {
    console.error("Passkey list error:", err);
    return NextResponse.json({ success: false, error: "Failed to query passkey status." }, { status: 500 });
  }
}
