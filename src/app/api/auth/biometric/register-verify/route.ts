import { NextRequest } from "next/server";
import { handleBiometricVerify } from "../verify/route";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleBiometricVerify(req, "register");
}
