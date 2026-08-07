import {
  PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS,
  PRODUCT_MASTER_SHOPLING_SALES_FALLBACK_CHUNK_DAYS,
  PRODUCT_MASTER_SHOPLING_SALES_MINIMUM_CHUNK_DAYS,
  createProductMasterShoplingSalesRequest,
  loadProductMasterShoplingSalesStatus,
  productMasterShoplingSalesConfigured,
  runProductMasterShoplingSalesStep,
} from "@/lib/productMasterShoplingSalesBackfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

function recoveryChunkDays(state: Awaited<ReturnType<typeof loadProductMasterShoplingSalesStatus>>) {
  if (state.state !== "FAILED") return null;
  if (state.chunkDays > PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS) {
    return PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS;
  }
  if (
    state.chunkDays > PRODUCT_MASTER_SHOPLING_SALES_FALLBACK_CHUNK_DAYS &&
    state.chunkDays <= PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS
  ) {
    return PRODUCT_MASTER_SHOPLING_SALES_FALLBACK_CHUNK_DAYS;
  }
  if (
    state.chunkDays > PRODUCT_MASTER_SHOPLING_SALES_MINIMUM_CHUNK_DAYS &&
    state.chunkDays <= PRODUCT_MASTER_SHOPLING_SALES_FALLBACK_CHUNK_DAYS
  ) {
    return PRODUCT_MASTER_SHOPLING_SALES_MINIMUM_CHUNK_DAYS;
  }
  return null;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!productMasterShoplingSalesConfigured()) {
    return Response.json({
      ok: true,
      configured: false,
      processed: false,
      state: "IDLE",
      message: "Shopling 판매원장 환경설정이 준비되지 않았습니다.",
    });
  }

  try {
    const current = await loadProductMasterShoplingSalesStatus();
    const fallback = recoveryChunkDays(current);
    if (current.state === "IDLE" || fallback !== null) {
      const chunkDays = fallback ?? PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS;
      const created = await createProductMasterShoplingSalesRequest({
        chunkDays,
        supersedesRequestId: current.requestId,
      });
      return Response.json({
        ok: true,
        configured: true,
        processed: true,
        state: "QUEUED",
        requestId: created.requestId,
        chunkDays: created.chunkDays,
        totalRanges: created.ranges.length,
        message:
          fallback === PRODUCT_MASTER_SHOPLING_SALES_FALLBACK_CHUNK_DAYS
            ? "30일 주문 조회 실패를 종료하고 7일 단위로 안전 재접수했습니다."
            : fallback === PRODUCT_MASTER_SHOPLING_SALES_MINIMUM_CHUNK_DAYS
              ? "7일 주문 조회 실패를 종료하고 2일 단위로 최종 안전 재접수했습니다."
              : "최근 24개월 Shopling 판매원장 읽기 작업을 접수했습니다.",
      });
    }

    if (current.state === "QUEUED" || current.state === "RUNNING") {
      return Response.json({
        ok: true,
        configured: true,
        ...(await runProductMasterShoplingSalesStep()),
      });
    }

    return Response.json({
      ok: true,
      configured: true,
      processed: false,
      state: current.state,
      message: current.message,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "PRODUCT_MASTER_SHOPLING_SALES_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 판매원장 Worker 실행에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
