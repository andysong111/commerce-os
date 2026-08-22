import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { fetchKeywordShoplingDirectApplyResult } from "@/lib/keywordShoplingDirectApplyRunner";
import { getProductLaunchAdminConfig } from "@/lib/productLaunchTrackerServer";
import { seoShoplingDirectApplySucceeded } from "@/lib/seoShoplingLiveRegistration";
import {
  callSeoLiveRpc,
  listActiveSeoLiveDispatches,
  patchSeoLiveDispatchByOwner,
  patchSeoLiveDispatchItemsByOwner,
} from "@/lib/seoShoplingLiveStorage";

export const runtime = "nodejs";
export const maxDuration = 50;

const MAX_ACTIVE_DISPATCHES = 5;
const DIRECT_APPLY_PHASES = new Set([
  "direct_apply_dispatching",
  "direct_apply_queued",
  "direct_apply_running",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { ok: false, message: "SEO 실제등록 후처리는 Production에서만 실행됩니다." },
      { status: 403 },
    );
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, message: "CRON_SECRET 설정이 없어 후처리를 차단했습니다." },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return NextResponse.json(
      { ok: false, message: "SEO 실제등록 후처리 인증에 실패했습니다." },
      { status: 401 },
    );
  }
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return NextResponse.json(config.body, { status: config.status });

  const dispatches = await listActiveSeoLiveDispatches(
    config.value,
    MAX_ACTIVE_DISPATCHES,
  );
  const results: Array<Record<string, unknown>> = [];

  for (const dispatch of dispatches) {
    const dispatchId = text(dispatch.dispatch_id);
    const ownerId = text(dispatch.owner_id);
    const reservationId = text(dispatch.reservation_id);
    const resultPayload = record(dispatch.result_payload);
    const phase = text(resultPayload.phase);
    if (!dispatchId || !ownerId || !reservationId) continue;

    if (phase === "review_finalization_pending") {
      try {
        const completedAt = new Date().toISOString();
        await callSeoLiveRpc<number>(
          config.value,
          "finalize_seo_title_reservation",
          {
            p_owner_id: ownerId,
            p_reservation_id: reservationId,
            p_dispatch_id: dispatchId,
            p_success: false,
          },
        );
        const reviewMessage =
          text(resultPayload.error) ||
          "상품명·검색어 실제 반영 결과를 확인해야 합니다.";
        await Promise.all([
          patchSeoLiveDispatchItemsByOwner(config.value, ownerId, dispatchId, {
            status: "failed",
            error_message: reviewMessage,
          }),
          patchSeoLiveDispatchByOwner(config.value, ownerId, dispatchId, {
            status: "failed",
            completed_at: completedAt,
            result_payload: {
              ...resultPayload,
              phase: "review_required",
              finalizationError: "",
              externalWriteExecuted: true,
              updatedAt: completedAt,
            },
          }),
        ]);
        results.push({
          dispatchId,
          status: "review_required",
          recoveredFinalization: true,
        });
      } catch (error) {
        results.push({
          dispatchId,
          status: "retry_review_finalization",
          message:
            error instanceof Error ? error.message : "review 격리 재시도 실패",
        });
      }
      continue;
    }

    if (!DIRECT_APPLY_PHASES.has(phase)) continue;
    const requestId = text(
      resultPayload.directApplyRequestId || dispatch.external_request_id,
    );
    if (!requestId) {
      results.push({
        dispatchId,
        status: "retry",
        message: "direct apply request ID를 기다리고 있습니다.",
      });
      continue;
    }

    try {
      const applied = await fetchKeywordShoplingDirectApplyResult(requestId);
      if (applied.status === "pending") {
        await patchSeoLiveDispatchByOwner(config.value, ownerId, dispatchId, {
          result_payload: {
            ...resultPayload,
            phase: "direct_apply_running",
            directApplyRequestId: requestId,
            directApplyRunUrl:
              applied.runUrl || resultPayload.directApplyRunUrl || "",
            directApplyMessage:
              applied.message || "실제 반영 진행 중",
            updatedAt: new Date().toISOString(),
          },
        });
        results.push({ dispatchId, status: "pending", phase: applied.phase });
        continue;
      }

      const completedAt = new Date().toISOString();
      const verified = seoShoplingDirectApplySucceeded(applied, 29);
      if (verified) {
        await callSeoLiveRpc<number>(
          config.value,
          "finalize_seo_title_reservation",
          {
            p_owner_id: ownerId,
            p_reservation_id: reservationId,
            p_dispatch_id: dispatchId,
            p_success: true,
          },
        );
        await Promise.all([
          patchSeoLiveDispatchItemsByOwner(config.value, ownerId, dispatchId, {
            status: "success",
            error_message: "",
          }),
          patchSeoLiveDispatchByOwner(config.value, ownerId, dispatchId, {
            status: "success",
            completed_at: completedAt,
            result_payload: {
              ...resultPayload,
              phase: "completed",
              directApplyRequestId: requestId,
              directApplyRunUrl:
                applied.runUrl || resultPayload.directApplyRunUrl || "",
              directApplySummary: applied.summary || {},
              externalWriteExecuted: true,
              verifiedItemCount: 29,
              updatedAt: completedAt,
            },
          }),
        ]);
        results.push({ dispatchId, status: "success", usedTitles: 29 });
        continue;
      }

      if (applied.status === "error" && applied.phase === "unknown") {
        await patchSeoLiveDispatchByOwner(config.value, ownerId, dispatchId, {
          result_payload: {
            ...resultPayload,
            phase,
            reconcileWarning:
              applied.message || "결과 확인 중 일시 오류",
            updatedAt: new Date().toISOString(),
          },
        });
        results.push({ dispatchId, status: "retry", phase: applied.phase });
        continue;
      }

      try {
        await callSeoLiveRpc<number>(
          config.value,
          "finalize_seo_title_reservation",
          {
            p_owner_id: ownerId,
            p_reservation_id: reservationId,
            p_dispatch_id: dispatchId,
            p_success: false,
          },
        );
      } catch (finalizationError) {
        await patchSeoLiveDispatchByOwner(config.value, ownerId, dispatchId, {
          status: "submitted",
          result_payload: {
            ...resultPayload,
            phase: "review_finalization_pending",
            directApplyRequestId: requestId,
            directApplyRunUrl:
              applied.runUrl || resultPayload.directApplyRunUrl || "",
            directApplySummary: applied.summary || {},
            error:
              applied.message || "실제 반영 실패 또는 부분 실패",
            finalizationError:
              finalizationError instanceof Error
                ? finalizationError.message
                : "review 격리 처리 실패",
            externalWriteExecuted: true,
            updatedAt: completedAt,
          },
        });
        results.push({
          dispatchId,
          status: "retry_review_finalization",
        });
        continue;
      }

      await Promise.all([
        patchSeoLiveDispatchItemsByOwner(config.value, ownerId, dispatchId, {
          status: "failed",
          error_message:
            applied.message ||
            "상품명·검색어 실제 반영 결과를 확인해야 합니다.",
        }),
        patchSeoLiveDispatchByOwner(config.value, ownerId, dispatchId, {
          status: "failed",
          completed_at: completedAt,
          result_payload: {
            ...resultPayload,
            phase: "review_required",
            directApplyRequestId: requestId,
            directApplyRunUrl:
              applied.runUrl || resultPayload.directApplyRunUrl || "",
            directApplySummary: applied.summary || {},
            directApplyMessage:
              applied.message || "실제 반영 실패 또는 부분 실패",
            externalWriteExecuted: true,
            updatedAt: completedAt,
          },
        }),
      ]);
      results.push({ dispatchId, status: "review_required" });
    } catch (error) {
      results.push({
        dispatchId,
        status: "retry",
        message:
          error instanceof Error ? error.message : "결과 확인 실패",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: dispatches.length,
    processed: results.length,
    results,
  });
}
