import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getAdminSafeState } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Administrative event status endpoint.
 * STRICT SECURITY REQUIREMENT:
 * Under no circumstances does this endpoint leak recipient mappings or encryptedRecipient blobs.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await verifyAdminRequest(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized. Admin credentials required." }, { status: 401 });
    }

    const state = await getAdminSafeState();

    return NextResponse.json({
      success: true,
      data: state,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error retrieving admin status";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
