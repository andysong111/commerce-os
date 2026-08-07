import {
  PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS,
  PRODUCT_MASTER_SHOPLING_SALES_FALLBACK_CHUNK_DAYS,
  PRODUCT_MASTER_SHOPLING_SALES_MINIMUM_CHUNK_DAYS,
  createProductMasterShoplingSalesRequest,
  loadProductMasterShoplingSalesStatus,
  productMasterShoplingSalesConfigured,
  runProductMasterShoplingSalesStep,
} from "@/lib/productMasterShoplingSalesBackfill";
import { ensureProductMasterShoplingOrderProbe } from "@/lib/productMasterShoplingOrderProbe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_STEPS_PER_INVOCATION = 6;
const EXTRA_STEP_START_BUDGET_MS = 10_000;
const ZERO_ROW_PROBE_MIN_COMPLETED_RANGES = 3;

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

async function runBoundedBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runProductMasterShoplingSalesStep();
  stepCount += 1;

  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runProductMasterShoplingSalesStep();
    stepCount += 1;
  }

  return {
    ...result,
    stepCount,
    burstElapsedMs: Date.now() - startedAt,
  };
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

    if (
      (current.state === "QUEUED" || current.state === "RUNNING") &&
      current.completedRanges >= ZERO_ROW_PROBE_MIN_COMPLETED_RANGES &&
      current.fetchedRows === 0
    ) {
      const probe = await ensureProductMasterShoplingOrderProbe();
      if (probe.executed) {
        return Response.json({
          ok: true,
          configured: true,
          processed: false,
          state: current.state,
          requestId: current.requestId,
          diagnosticProbeExecuted: true,
          diagnosticCategory: probe.result.category,
          diagnosticParsedRows: probe.result.parsedRowCount,
          diagnosticResponseBytes: probe.result.responseBytes,
          message:
            "여러 Shopling 주문 구간에서 원시 주문행이 0건이라 이번 Worker 호출은 판매원장 진행 대신 읽기 전용 응답구조 진단을 실행했습니다.",
        });
      }
    }

    if (current.state === "QUEUED" || current.state === "RUNNING") {
      return Response.json({
        ok: true,
        configured: true,
        ...(await runBoundedBurst()),
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
