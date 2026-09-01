import { dispatchInternalChinaPriceReadbackV2 } from "@/lib/internalChinaGroupCostPriceReadbackV2";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

async function execute(proposalFingerprint: unknown) {
  try {
    const result = await dispatchInternalChinaPriceReadbackV2({ proposalFingerprint });
    return Response.json(
      {
        ok: true,
        ...result,
        message: result.duplicate
          ? "v2 읽기 전용 재조회는 이미 전송되어 중복 실행하지 않았습니다."
          : `v2 읽기 전용 재조회 ${result.receipt.batchCount}개 배치를 전송했습니다. 가격 쓰기는 발생하지 않습니다.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "INTERNAL_CHINA_PRICE_READBACK_V2_FAILED";
    return Response.json(
      { ok: false, code: raw.split(":", 1)[0], message: raw },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json({ ok: false, code: "SAME_ORIGIN_REQUIRED" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  return execute(body?.proposalFingerprint);
}

// Read-only and idempotent diagnostic trigger. Each approved fingerprint is dispatched once.
export async function GET(request: Request) {
  return execute(new URL(request.url).searchParams.get("proposalFingerprint"));
}
