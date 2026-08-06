import {
  PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS,
  PRODUCT_MASTER_SHOPLING_FALLBACK_CHUNK_DAYS,
  createProductMasterShoplingDiagnosticRequest,
  loadProductMasterShoplingDiagnosticStatus,
  productMasterShoplingDiagnosticConfigured,
  runProductMasterShoplingDiagnosticStep,
} from "@/lib/productMasterShoplingDiagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PRODUCT_MASTER_SHOPLING_MINIMUM_CHUNK_DAYS = 1;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  return Boolean(expected && authorization === `Bearer ${expected}`);
}

function recoveryChunkDays(
  state: Awaited<ReturnType<typeof loadProductMasterShoplingDiagnosticStatus>>,
) {
  if (state.state !== "FAILED") return null;
  if (state.chunkDays > PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS) {
    return PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS;
  }
  if (
    state.chunkDays > PRODUCT_MASTER_SHOPLING_FALLBACK_CHUNK_DAYS &&
    state.chunkDays <= PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS
  ) {
    return PRODUCT_MASTER_SHOPLING_FALLBACK_CHUNK_DAYS;
  }
  if (
    state.chunkDays > PRODUCT_MASTER_SHOPLING_MINIMUM_CHUNK_DAYS &&
    state.chunkDays <= PRODUCT_MASTER_SHOPLING_FALLBACK_CHUNK_DAYS
  ) {
    return PRODUCT_MASTER_SHOPLING_MINIMUM_CHUNK_DAYS;
  }
  return null;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  if (!productMasterShoplingDiagnosticConfigured()) {
    return Response.json(
      {
        ok: true,
        configured: false,
        processed: false,
        state: "IDLE",
        message:
          "상품마스터 Shopling 전수진단 환경변수가 준비되지 않아 작업을 실행하지 않았습니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const current = await loadProductMasterShoplingDiagnosticStatus();
    const fallbackChunkDays = recoveryChunkDays(current);
    if (current.state === "IDLE" || fallbackChunkDays !== null) {
      const chunkDays =
        fallbackChunkDays ?? PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS;
      const created = await createProductMasterShoplingDiagnosticRequest({
        chunkDays,
        supersedesRequestId: current.requestId,
      });
      const recoveryMessage =
        fallbackChunkDays === PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS
          ? "기존 장기 조회 구간 실패를 종료하고 최근 24개월을 최대 30일 단위로 다시 접수했습니다."
          : fallbackChunkDays === PRODUCT_MASTER_SHOPLING_FALLBACK_CHUNK_DAYS
            ? "30일 조회 구간 실패를 종료하고 최근 24개월을 최대 7일 단위로 한 번 더 안전하게 접수했습니다."
            : fallbackChunkDays ===
                PRODUCT_MASTER_SHOPLING_MINIMUM_CHUNK_DAYS
              ? "7일 조회 구간 실패를 종료하고 최근 24개월을 하루 단위로 최종 안전 재접수했습니다."
              : "최초 상품마스터 Shopling 전수진단을 최근 24개월·최대 30일 단위로 자동 접수했습니다.";
      return Response.json(
        {
          ok: true,
          configured: true,
          processed: true,
          state: "QUEUED",
          requestId: created.requestId,
          supersedesRequestId: created.supersedesRequestId,
          chunkDays: created.chunkDays,
          totalRanges: created.ranges.length,
          message: `${recoveryMessage} 다음 1분 Worker부터 기간별 조회를 시작합니다.`,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      {
        ok: true,
        configured: true,
        ...(await runProductMasterShoplingDiagnosticStep()),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상품마스터 Shopling 전수진단 Worker 실행에 실패했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
