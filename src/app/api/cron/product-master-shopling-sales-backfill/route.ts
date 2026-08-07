import {
  PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS,
  PRODUCT_MASTER_SHOPLING_SALES_FALLBACK_CHUNK_DAYS,
  PRODUCT_MASTER_SHOPLING_SALES_MINIMUM_CHUNK_DAYS,
  createProductMasterShoplingSalesRequest,
  loadProductMasterShoplingSalesStatus,
  productMasterShoplingSalesConfigured,
  runProductMasterShoplingSalesStep,
} from "@/lib/productMasterShoplingSalesBackfill";
import {
  createProductMasterShoplingSalesDirectCodeEvidenceRequest,
  loadProductMasterShoplingSalesDirectCodeEvidenceStatus,
  runProductMasterShoplingSalesDirectCodeEvidenceStep,
} from "@/lib/productMasterShoplingSalesDirectCodeEvidence";
import {
  createProductMasterShoplingSalesHistoricalShadowRequest,
  loadProductMasterShoplingSalesHistoricalShadowStatus,
  runProductMasterShoplingSalesHistoricalShadowStep,
} from "@/lib/productMasterShoplingSalesHistoricalShadow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_STEPS_PER_INVOCATION = 6;
const EXTRA_STEP_START_BUDGET_MS = 10_000;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

function recoveryChunkDays(
  state: Awaited<ReturnType<typeof loadProductMasterShoplingSalesStatus>>,
) {
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

async function runHistoricalShadowBoundedBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runProductMasterShoplingSalesHistoricalShadowStep();
  stepCount += 1;

  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runProductMasterShoplingSalesHistoricalShadowStep();
    stepCount += 1;
  }

  return {
    ...result,
    stepCount,
    burstElapsedMs: Date.now() - startedAt,
  };
}

async function runDirectCodeEvidenceBoundedBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runProductMasterShoplingSalesDirectCodeEvidenceStep();
  stepCount += 1;

  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runProductMasterShoplingSalesDirectCodeEvidenceStep();
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
      const chunkDays =
        fallback ?? PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS;
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
        ...(await runBoundedBurst()),
      });
    }

    if (current.state === "BLOCKED") {
      const directEvidence =
        await loadProductMasterShoplingSalesDirectCodeEvidenceStatus();
      if (
        directEvidence.state === "QUEUED" ||
        directEvidence.state === "RUNNING"
      ) {
        const evidenceResult = await runDirectCodeEvidenceBoundedBurst();
        return Response.json({
          ok: true,
          configured: true,
          evidenceState: "RUNNING",
          ...evidenceResult,
        });
      }
      if (
        directEvidence.state === "COMPLETED" ||
        directEvidence.state === "FAILED"
      ) {
        return Response.json({
          ok: true,
          configured: true,
          processed: false,
          state: current.state,
          evidenceState: directEvidence.state,
          directEvidenceRows: directEvidence.directEvidenceRows,
          safeOptionIdCount: directEvidence.safeOptionIdCount,
          highConfidenceStoredSampleCandidates:
            directEvidence.highConfidenceStoredSampleCandidates,
          message: directEvidence.message,
        });
      }

      const shadow = await loadProductMasterShoplingSalesHistoricalShadowStatus();
      if (shadow.state === "IDLE") {
        try {
          const created =
            await createProductMasterShoplingSalesHistoricalShadowRequest();
          return Response.json({
            ok: true,
            configured: true,
            processed: true,
            state: "SHADOW_QUEUED",
            requestId: created.requestId,
            baselineRequestId: created.baselineRequestId,
            totalRanges: created.ranges.length,
            message:
              "미연결 주문 중 과거 optionId 고신뢰 증거가 있어 동일 주문범위 그림자 재계산을 자동 접수했습니다. 실제 판매원장 쓰기는 없습니다.",
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "historical shadow 접수 실패";
          if (
            /SHADOW_NO_EVIDENCE|SHADOW_NO_SAFE_RESOLVER/.test(message)
          ) {
            const created =
              await createProductMasterShoplingSalesDirectCodeEvidenceRequest();
            return Response.json({
              ok: true,
              configured: true,
              processed: true,
              state: "DIRECT_CODE_EVIDENCE_QUEUED",
              requestId: created.requestId,
              baselineRequestId: created.baselineRequestId,
              totalRanges: created.ranges.length,
              message:
                "과거 상품 catalog에 exact optionId가 없어, 동일 optionId의 다른 주문행에 직접 위치코드가 남아 있는지 읽기 전용 전수 스캔을 자동 접수했습니다.",
            });
          }
          throw error;
        }
      }

      if (shadow.state === "QUEUED" || shadow.state === "RUNNING") {
        const shadowResult = await runHistoricalShadowBoundedBurst();
        return Response.json({
          ok: true,
          configured: true,
          shadowState: "RUNNING",
          ...shadowResult,
        });
      }

      return Response.json({
        ok: true,
        configured: true,
        processed: false,
        state: current.state,
        shadowState: shadow.state,
        shadowSafeToPromote: shadow.report?.safeToPromote ?? false,
        shadowFallbackResolvedRows:
          shadow.report?.shadow.fallbackResolvedRows ?? shadow.fallbackResolvedRows,
        message: shadow.message || current.message,
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
