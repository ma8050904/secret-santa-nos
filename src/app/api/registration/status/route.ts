import { NextResponse } from "next/server";
import { getRegistrationSessionStatus } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getRegistrationSessionStatus();
    return NextResponse.json(status);
  } catch (err: unknown) {
    console.error("Failed to get registration status:", err);
    return NextResponse.json(
      { success: false, error: "Failed to retrieve registration status." },
      { status: 500 }
    );
  }
}
