import { NextRequest } from "next/server";
import { handleBiometricOptions } from "../options/route";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleBiometricOptions(req, "register");
}
