import type { ProductLaunchAdminConfig, ProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";
import {
  callSeoTitleRpc,
  patchSeoTitleDispatch,
  patchSeoTitleDispatchItems,
  readSeoTitleDispatchItems,
  type SeoTitleLedgerContext,
} from "@/lib/seoTitleLedgerServer";
import {
  extractSeoShoplingGoodsKeys,
  SEO_SHOPLING_GROUPS,
} from "@/lib/seoShoplingLiveRegistration";
import {
  dispatchPreparedSeoShoplingDirectApply,
  prepareSeoShoplingDirectApply,
} from "@/lib/seoShoplingDirectPrepared";
import { patchSeoLiveDispatchItemsForGroup } from "@/lib/seoShoplingLiveStorage";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function readSeoBulkMetadata(job: UnknownRecord) {
  const payload = record(job.payload);
  const meta = record(payload.seoBulk);
  const dispatchId = text(meta.dispatchId);
  const ledgerId = text(meta.ledgerId);
  const reservationId = text(meta.reservationId);
  if (!dispatchId || !ledgerId || !reservationId) return null;
  return {
    dispatchId,
    ledgerId,
    reservationId,
    canonicalSeed: meta.canonicalSeed === true,
    pipelineVersion: text(meta.pipelineVersion),
  };
}

export async function handleSeoShoplingProductUploadCallback(
  config: ProductLaunchAdminConfig,
  job: UnknownRecord,
  input: {
    status: "success" | "partial_failure" | "failed";
    rows: UnknownRecord[];
    errorMessage: string;
    result?: UnknownRecord;
  },
  completedAt: string,
) {
  const meta = readSeoBulkMetadata(job);
  if (!meta) return { handled: false as const };

  const identity: ProductLaunchIdentity = {
    userId: text(job.owner_id),
    email: text(job.owner_email),
  };
  const context: SeoTitleLedgerContext = { config, identity };
  const items = await readSeoTitleDispatchItems(context, meta.dispatchId);
  if (items.length !== 29) {
    await quarantineDispatch(
      context,
      meta,
      "예약된 전체몰 상품명이 29개가 아니어서 실제 반영을 중단했습니다.",
      completedAt,
      "",
    );
    return { handled: true as const, ok: false as const };
  }

  if (input.status !== "success") {
    await quarantineDispatch(
      context,
      meta,
      input.errorMessage ||
        "샵플링 기본상품 6개 신규등록이 모두 성공하지 않아 SEO 반영을 중단했습니다.",
      completedAt,
      "",
    );
    return { handled: true as const, ok: false as const };
  }

  let requestId = "";
  let claimed = false;
  try {
    const goodsKeys = extractSeoShoplingGoodsKeys(input.rows);
    for (const group of SEO_SHOPLING_GROUPS) {
      await patchSeoLiveDispatchItemsForGroup(context, meta.dispatchId, group, {
        goods_key: goodsKeys[group],
        status: "submitted",
      });
    }
    const refreshedItems = await readSeoTitleDispatchItems(context, meta.dispatchId);
    const prepared = prepareSeoShoplingDirectApply(refreshedItems, goodsKeys);
    requestId = prepared.requestId;
    const claimPayload = {
      pipelineVersion: meta.pipelineVersion,
      phase: "direct_apply_dispatching",
      canonicalSeed: meta.canonicalSeed,
      productUploadJobId: text(job.id),
      productUploadRequestId: text(job.request_id),
      productUploadStatus: input.status,
      createdGoodsKeys: goodsKeys,
      directApplyRequestId: prepared.requestId,
      directApplyRunUrl: prepared.githubActionsUrl,
      externalWriteExecuted: true,
      updatedAt: completedAt,
    };
    claimed =
      (await callSeoTitleRpc<boolean>(
        context,
        "claim_seo_title_dispatch_direct_apply",
        {
          p_owner_id: context.identity.userId,
          p_dispatch_id: meta.dispatchId,
          p_request_id: prepared.requestId,
          p_result_payload: claimPayload,
        },
      )) === true;

    if (!claimed) {
      return {
        handled: true as const,
        ok: true as const,
        duplicateCallback: true as const,
        directApplyRequestId: "",
      };
    }

    const apply = await dispatchPreparedSeoShoplingDirectApply(prepared);
    await patchSeoTitleDispatch(context, meta.dispatchId, {
      status: "submitted",
      external_request_id: apply.requestId,
      submitted_at: completedAt,
      result_payload: {
        ...claimPayload,
        phase: "direct_apply_queued",
        directApplyRequestId: apply.requestId,
        directApplyRunUrl: apply.runUrl || apply.githubActionsUrl || "",
        externalWriteExecuted: true,
        updatedAt: completedAt,
      },
    });
    return {
      handled: true as const,
      ok: true as const,
      goodsKeys,
      directApplyRequestId: apply.requestId,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "쇼핑몰별 상품명·검색어 반영을 시작하지 못했습니다.";
    await quarantineDispatch(context, meta, message, completedAt, requestId);
    return {
      handled: true as const,
      ok: false as const,
      directApplyRequestId: requestId,
      claimed,
    };
  }
}

async function quarantineDispatch(
  context: SeoTitleLedgerContext,
  meta: {
    dispatchId: string;
    reservationId: string;
    pipelineVersion: string;
    canonicalSeed: boolean;
  },
  message: string,
  completedAt: string,
  directApplyRequestId: string,
) {
  try {
    await callSeoTitleRpc<number>(context, "finalize_seo_title_reservation", {
      p_owner_id: context.identity.userId,
      p_reservation_id: meta.reservationId,
      p_dispatch_id: meta.dispatchId,
      p_success: false,
    });
  } catch (finalizationError) {
    const finalizationMessage =
      finalizationError instanceof Error
        ? finalizationError.message
        : "상품명 review 격리 처리에 실패했습니다.";
    await Promise.all([
      patchSeoTitleDispatch(context, meta.dispatchId, {
        status: "submitted",
        ...(directApplyRequestId
          ? { external_request_id: directApplyRequestId }
          : {}),
        result_payload: {
          pipelineVersion: meta.pipelineVersion,
          phase: "review_finalization_pending",
          canonicalSeed: meta.canonicalSeed,
          directApplyRequestId,
          error: message,
          finalizationError: finalizationMessage,
          externalWriteExecuted: true,
          updatedAt: completedAt,
        },
      }),
      patchSeoTitleDispatchItems(context, meta.dispatchId, {
        status: "submitted",
        error_message: message,
      }),
    ]);
    return false;
  }

  await Promise.all([
    patchSeoTitleDispatch(context, meta.dispatchId, {
      status: "failed",
      ...(directApplyRequestId
        ? { external_request_id: directApplyRequestId }
        : {}),
      completed_at: completedAt,
      result_payload: {
        pipelineVersion: meta.pipelineVersion,
        phase: "review_required",
        canonicalSeed: meta.canonicalSeed,
        directApplyRequestId,
        error: message,
        externalWriteExecuted: true,
        updatedAt: completedAt,
      },
    }),
    patchSeoTitleDispatchItems(context, meta.dispatchId, {
      status: "failed",
      error_message: message,
    }),
  ]);
  return true;
}
