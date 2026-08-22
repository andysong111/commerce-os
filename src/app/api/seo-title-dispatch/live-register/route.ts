import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

import { PRODUCT_GROUP_MARKET_REGISTRY } from "@/lib/productGroupMarketRegistry";
import {
  SEO_TITLE_FULL_MARKET_SIZE,
  SEO_TITLE_GROUP_QUOTAS,
  type SeoTitleProductGroup,
} from "@/lib/seoTitleInventoryGenerator";
import {
  callSeoTitleRpc,
  insertSeoTitleDispatch,
  insertSeoTitleDispatchItems,
  listSeoTitleDispatches,
  patchSeoTitleDispatch,
  patchSeoTitleDispatchItems,
  readSeoTitleLedger,
  requireSeoTitleLedgerContext,
} from "@/lib/seoTitleLedgerServer";
import {
  createSeoShoplingProductUploadJob,
  dispatchSeoShoplingDirectApply,
  readSeoShoplingCanonicalGoodsKeys,
  readSeoShoplingLaunchState,
  SEO_SHOPLING_LIVE_PIPELINE_VERSION,
  SEO_SHOPLING_LIVE_RESERVATION_TTL_MINUTES,
  seoShoplingCanonicalMode,
  type SeoShoplingGoodsKeys,
} from "@/lib/seoShoplingLiveRegistration";
import { patchSeoLiveDispatchItemsForGroup } from "@/lib/seoShoplingLiveStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReservedTitle = {
  title_id: string;
  ledger_id: string;
  product_group: SeoTitleProductGroup;
  title: string;
  quality_score: number;
  source_materials: string[];
  reservation_id: string;
  reservation_expires_at: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function groupCounts() {
  return Object.fromEntries(
    (Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]).map((group) => [
      group,
      SEO_TITLE_GROUP_QUOTAS[group],
    ]),
  );
}

function buildReservedPlan(
  dispatchId: string,
  commonSearchLine: string,
  reserved: ReservedTitle[],
  goodsKeys?: Partial<SeoShoplingGoodsKeys>,
) {
  const byGroup = new Map<SeoTitleProductGroup, ReservedTitle[]>();
  for (const group of Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]) {
    byGroup.set(
      group,
      reserved
        .filter((row) => row.product_group === group)
        .sort(
          (left, right) =>
            Number(right.quality_score) - Number(left.quality_score) ||
            left.title.localeCompare(right.title, "ko"),
        ),
    );
  }
  const plan: Array<Record<string, unknown>> = [];
  for (const market of PRODUCT_GROUP_MARKET_REGISTRY) {
    const group = market.productGroup as SeoTitleProductGroup;
    const titleRow = byGroup.get(group)?.shift();
    if (!titleRow) throw new Error(`${group} 예약 상품명이 부족합니다.`);
    plan.push({
      dispatch_id: dispatchId,
      registration_round: 1,
      title_id: titleRow.title_id,
      ledger_id: titleRow.ledger_id,
      product_group: group,
      market_name: market.marketName,
      mall_key: market.mallKey,
      account_id_label: market.accountIdLabel,
      goods_key: goodsKeys?.[group] ?? "",
      title: titleRow.title,
      common_search_line: commonSearchLine,
      quality_score: Number(titleRow.quality_score) || 0,
      source_materials: Array.isArray(titleRow.source_materials)
        ? titleRow.source_materials
        : [],
    });
  }
  if (plan.length !== SEO_TITLE_FULL_MARKET_SIZE) {
    throw new Error(`전체몰 실행계획이 ${SEO_TITLE_FULL_MARKET_SIZE}개가 아닙니다.`);
  }
  return plan;
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const body = record(await request.json().catch(() => ({})));
  const ledgerId = text(body.ledgerId);
  if (!ledgerId) {
    return Response.json(
      { ok: false, code: "SEO_TITLE_LEDGER_ID_REQUIRED", message: "실제 등록할 SEO 원장을 선택하세요." },
      { status: 400 },
    );
  }

  const reservationId = randomUUID();
  const dispatchId = randomUUID();
  let reservationCreated = false;
  let dispatchCreated = false;

  try {
    const detail = await readSeoTitleLedger(context, ledgerId);
    if (!detail?.ledger || !detail.stats) throw new Error("SEO 상품명 원장을 찾지 못했습니다.");
    if (!detail.ledger.launch_item_id) {
      return Response.json(
        { ok: false, code: "SEO_TITLE_LAUNCH_ITEM_NOT_LINKED", message: "상품출시 진행관리와 연결된 원장만 실제 등록할 수 있습니다." },
        { status: 409 },
      );
    }
    if (Number(detail.stats.full_market_rounds_available) < 1) {
      return Response.json(
        { ok: false, code: "SEO_TITLE_INVENTORY_SHORTAGE", message: "전체몰 1회분 상품명 재고 29개가 부족합니다. 먼저 원장을 보충하세요." },
        { status: 409 },
      );
    }
    if (Number(detail.stats.review_count) > 0) {
      return Response.json(
        { ok: false, code: "SEO_TITLE_REVIEW_PENDING", message: "이전 실제등록에서 확인이 필요한 상품명이 남아 있습니다. 먼저 출고센터의 확인필요 건을 정리하세요." },
        { status: 409 },
      );
    }

    const recentDispatches = await listSeoTitleDispatches(context, { ledgerId, limit: 20 });
    const active = recentDispatches.find((row) => ["reserved", "ready", "submitted"].includes(text(row.status)));
    if (active) {
      return Response.json(
        { ok: false, code: "SEO_TITLE_ACTIVE_DISPATCH_EXISTS", message: "이 상품에 이미 진행 중인 출고가 있습니다. 완료 후 다음 등록을 실행하세요.", dispatchId: active.dispatch_id },
        { status: 409 },
      );
    }

    const launch = await readSeoShoplingLaunchState(context, detail.ledger.launch_item_id);
    const canonicalGoodsKeys = readSeoShoplingCanonicalGoodsKeys(launch.item);
    const canonicalMode = seoShoplingCanonicalMode(canonicalGoodsKeys);
    const usedCount = Number(detail.stats.used_count) || 0;
    if (canonicalMode === "partial") {
      return Response.json(
        { ok: false, code: "SHOPLING_CANONICAL_PARTIAL", message: "기존 6개 상품그룹 goods_key가 일부만 존재합니다. 중복등록 위험 때문에 실제 등록을 차단했습니다." },
        { status: 409 },
      );
    }
    if (canonicalMode === "empty" && usedCount > 0) {
      return Response.json(
        { ok: false, code: "SEO_TITLE_CANONICAL_STATE_MISMATCH", message: "상품명 사용 이력은 있지만 기준 goods_key가 없습니다. 원장 상태를 확인해야 합니다." },
        { status: 409 },
      );
    }

    const mode =
      canonicalMode === "complete" && usedCount === 0
        ? "apply_existing_first"
        : canonicalMode === "empty"
          ? "canonical_seed"
          : "additional_registration";

    const reserved = await callSeoTitleRpc<ReservedTitle[]>(
      context,
      "reserve_seo_title_inventory",
      {
        p_owner_id: context.identity.userId,
        p_ledger_id: ledgerId,
        p_group_counts: groupCounts(),
        p_reservation_id: reservationId,
        p_ttl_minutes: SEO_SHOPLING_LIVE_RESERVATION_TTL_MINUTES,
      },
    );
    reservationCreated = true;
    if (!Array.isArray(reserved) || reserved.length !== SEO_TITLE_FULL_MARKET_SIZE) {
      throw new Error(`예약된 상품명이 ${SEO_TITLE_FULL_MARKET_SIZE}개가 아닙니다.`);
    }

    const initialGoodsKeys = mode === "apply_existing_first" ? canonicalGoodsKeys : undefined;
    const plan = buildReservedPlan(
      dispatchId,
      detail.ledger.common_search_line,
      reserved,
      initialGoodsKeys,
    );
    const now = new Date().toISOString();
    const expiry = reserved[0]?.reservation_expires_at ?? null;
    const dispatch = await insertSeoTitleDispatch(context, {
      dispatch_id: dispatchId,
      ledger_id: ledgerId,
      reservation_id: reservationId,
      launch_item_id: detail.ledger.launch_item_id,
      dispatch_kind: "shopling_prepare",
      status: "submitted",
      registration_rounds: 1,
      requested_title_count: SEO_TITLE_FULL_MARKET_SIZE,
      reserved_title_count: reserved.length,
      common_search_line: detail.ledger.common_search_line,
      execution_plan: plan,
      result_payload: {
        pipelineVersion: SEO_SHOPLING_LIVE_PIPELINE_VERSION,
        phase: mode === "apply_existing_first" ? "direct_apply_preparing" : "base_upload_preparing",
        mode,
        externalWriteExecuted: false,
        updatedAt: now,
      },
      reservation_expires_at: expiry,
      submitted_at: now,
    });
    if (!dispatch) throw new Error("실제등록 출고 원장을 만들지 못했습니다.");
    dispatchCreated = true;

    await insertSeoTitleDispatchItems(
      context,
      plan.map((row) => ({
        dispatch_id: dispatchId,
        ledger_id: ledgerId,
        title_id: row.title_id,
        product_group: row.product_group,
        market_name: row.market_name,
        mall_key: row.mall_key,
        account_id_label: row.account_id_label,
        goods_key: row.goods_key,
        title: row.title,
        common_search_line: row.common_search_line,
        status: "submitted",
      })),
    );

    if (mode === "apply_existing_first") {
      for (const group of Object.keys(canonicalGoodsKeys) as SeoTitleProductGroup[]) {
        await patchSeoLiveDispatchItemsForGroup(context, dispatchId, group, {
          goods_key: canonicalGoodsKeys[group],
          status: "submitted",
        });
      }
      const apply = await dispatchSeoShoplingDirectApply(plan, canonicalGoodsKeys);
      await patchSeoTitleDispatch(context, dispatchId, {
        external_request_id: apply.requestId,
        result_payload: {
          pipelineVersion: SEO_SHOPLING_LIVE_PIPELINE_VERSION,
          phase: "direct_apply_queued",
          mode,
          canonicalSeed: false,
          createdGoodsKeys: canonicalGoodsKeys,
          directApplyRequestId: apply.requestId,
          directApplyRunUrl: apply.runUrl || apply.githubActionsUrl || "",
          externalWriteExecuted: true,
          updatedAt: new Date().toISOString(),
        },
      });
      return Response.json({
        ok: true,
        status: "submitted",
        mode,
        dispatchId,
        reservationId,
        directApplyRequestId: apply.requestId,
        message: "기존 기준상품 6개에 전체몰 SEO 상품명 29개와 공통 검색어 10개 실제 반영을 시작했습니다.",
      });
    }

    const upload = await createSeoShoplingProductUploadJob(context, {
      launchItemId: detail.ledger.launch_item_id,
      dispatchId,
      ledgerId,
      reservationId,
      canonicalSeed: mode === "canonical_seed",
    });
    await patchSeoTitleDispatch(context, dispatchId, {
      result_payload: {
        pipelineVersion: SEO_SHOPLING_LIVE_PIPELINE_VERSION,
        phase: "base_upload_queued",
        mode,
        canonicalSeed: mode === "canonical_seed",
        productUploadJobId: upload.jobId,
        productUploadRequestId: upload.requestId,
        productUploadActionsUrl: upload.actionsUrl || "",
        externalWriteExecuted: true,
        updatedAt: new Date().toISOString(),
      },
    });
    return Response.json({
      ok: true,
      status: "submitted",
      mode,
      dispatchId,
      reservationId,
      productUploadJobId: upload.jobId,
      message:
        mode === "canonical_seed"
          ? "샵플링 기준상품 6개 첫 등록을 시작했습니다. 완료되면 쇼핑몰별 상품명 29개와 검색어가 자동으로 이어집니다."
          : "추가 대량등록용 샵플링 상품 6개를 새 자사상품코드로 생성 중입니다. 완료되면 29개 쇼핑몰 SEO 적용이 자동으로 이어집니다.",
    });
  } catch (error) {
    if (reservationCreated) {
      await callSeoTitleRpc<number>(context, "release_seo_title_reservation", {
        p_owner_id: context.identity.userId,
        p_reservation_id: reservationId,
      }).catch(() => null);
    }
    if (dispatchCreated) {
      await patchSeoTitleDispatch(context, dispatchId, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
        result_payload: {
          pipelineVersion: SEO_SHOPLING_LIVE_PIPELINE_VERSION,
          phase: "start_failed",
          error: error instanceof Error ? error.message : "실제등록 시작 실패",
          externalWriteExecuted: false,
          updatedAt: new Date().toISOString(),
        },
      }).catch(() => null);
      await patchSeoTitleDispatchItems(context, dispatchId, { status: "cancelled" }).catch(() => null);
    }
    return Response.json(
      {
        ok: false,
        code: "SEO_SHOPLING_LIVE_START_FAILED",
        message: error instanceof Error ? error.message : "샵플링 실제등록을 시작하지 못했습니다.",
      },
      { status: 400 },
    );
  }
}
