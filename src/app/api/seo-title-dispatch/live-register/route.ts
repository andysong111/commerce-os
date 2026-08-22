import type { NextRequest } from "next/server";
import { POST as postLiveRegister } from "../live-register-v2/route";
import { getSeoShoplingLiveReadiness } from "@/lib/seoShoplingLiveReadiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = getSeoShoplingLiveReadiness();
  return Response.json({ ok: true, ...readiness });
}

export async function POST(request: NextRequest) {
  const readiness = getSeoShoplingLiveReadiness();
  if (!readiness.ready) {
    return Response.json(
      {
        ok: false,
        code: "SEO_SHOPLING_LIVE_NOT_READY",
        message: `샵플링 SEO 실제등록 연결이 아직 준비되지 않았습니다. 미설정: ${readiness.missing.join(", ")}`,
        missing: readiness.missing,
      },
      { status: 503 },
    );
  }
  return postLiveRegister(request);
}
