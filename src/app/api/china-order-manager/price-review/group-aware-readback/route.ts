import { dispatchInternalChinaPriceReadback } from "@/lib/internalChinaGroupCostPriceReadback";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function errorResponse(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : "INTERNAL_CHINA_PRICE_READBACK_FAILED";
  const code = raw.split(":", 1)[0] || "INTERNAL_CHINA_PRICE_READBACK_FAILED";
  const message =
    code === "INTERNAL_CHINA_PRICE_READBACK_APPLY_REQUIRED"
      ? "먼저 승인된 확정원가 목표가를 Shopling에 적용해야 합니다."
      : code === "INTERNAL_CHINA_PRICE_READBACK_PROPOSAL_STALE"
        ? "현재 가격조정안과 적용된 가격조정안이 다릅니다. 새로고침 후 확인하세요."
        : code === "INTERNAL_CHINA_PRICE_READBACK_BATCH_STATE_UNCERTAIN"
          ? "이전 재조회 배치 상태가 불확실해 중복 검증을 막았습니다. 운영 이력을 확인하세요."
          : raw;
  return Response.json(
    { ok: false, code, message },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

function successResponse(result: Awaited<ReturnType<typeof dispatchInternalChinaPriceReadback>>) {
  return Response.json(
    {
      ok: true,
      ...result,
      message: result.duplicate
        ? "동일 가격조정안의 Shopling 재조회 검증이 이미 전송되어 중복 실행하지 않았습니다."
        : `읽기 전용 재조회 검증 ${result.receipt.batchCount.toLocaleString("ko-KR")}개 배치를 전송했습니다. Shopling 가격 쓰기는 발생하지 않습니다.`,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "INTERNAL_CHINA_PRICE_READBACK_UNAUTHORIZED",
        message: "Ops Center 동일 출처에서만 Shopling 가격 재조회 검증을 시작할 수 있습니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return successResponse(
      await dispatchInternalChinaPriceReadback(
        await request.json().catch(() => ({})),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

// GET exists only for the idempotent, read-only verification trigger used by
// Commerce OS operations/diagnostics. It can dispatch each fingerprint once,
// performs no Shopling write, and subsequent calls return the stored receipt.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return successResponse(
      await dispatchInternalChinaPriceReadback({
        proposalFingerprint: url.searchParams.get("proposalFingerprint"),
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
