import type { NextRequest } from "next/server";
import { POST as postLiveRegister } from "../live-register-v2/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return postLiveRegister(request);
}
