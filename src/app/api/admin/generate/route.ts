import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { generateAssignments } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    if (!verifyAdminRequest(req)) {
      return NextResponse.json({ success: false, error: "Unauthorized. Admin credentials required." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const force = Boolean(body.force);

    const result = await generateAssignments(force);

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error generating assignments";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
