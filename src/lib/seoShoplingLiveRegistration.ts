import { randomUUID } from "node:crypto";

import { dispatchKeywordShoplingDirectApply, KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION } from "@/lib/keywordShoplingDirectApplyRunner";
import { buildProductLaunchShoplingPayload, type ProductLaunchShoplingPayload } from "@/lib/productLaunchTrackerShopling";
import {
  readProductLaunchError,
  readProductLaunchState,
  readResponseJson,
} from "@/lib/productLaunchTrackerServer";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import type { SeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";

export const SEO_SHOPLING_LIVE_PIPELINE_VERSION = "seo-shopling-live-registration-v1";
export const SEO_SHOPLING_LIVE_ROUNDS_PER_RUN = 1;
export const SEO_SHOPLING_LIVE_RESERVATION_TTL_MINUTES = 240;

export const SEO_SHOPLING_GROUPS = [
  "도매1",
  "도매2",
  "도매3",
  "도매4",
  "소매1",
  "소매2",
] as const;
export type SeoShoplingGroup = (typeof SEO_SHOPLING_GROUPS)[number];

const CHANNEL_KEY_BY_GROUP: Record<SeoShoplingGroup, string> = {
  도매1: "wholesale1",
  도매2: "wholesale2",
  도매3: "wholesale3",
  도매4: "wholesale4",
  소매1: "retail1",
  소매2: "retail2",
};
const GROUP_BY_CHANNEL_KEY = Object.fromEntries(
  Object.entries(CHANNEL_KEY_BY_GROUP).map(([group, key]) => [key, group]),
) as Record<string, SeoShoplingGroup>;
const GROUP_BY_LABEL = Object.fromEntries(SEO_SHOPLING_GROUPS.map((group) => [group, group])) as Record<string, SeoShoplingGroup>;

export type SeoShoplingGoodsKeys = Record<SeoShoplingGroup, string>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function emptySeoShoplingGoodsKeys(): SeoShoplingGoodsKeys {
  return {
    도매1: "",
    도매2: "",
    도매3: "",
    도매4: "",
    소매1: "",
    소매2: "",
  };
}

export function readSeoShoplingCanonicalGoodsKeys(itemInput: unknown): SeoShoplingGoodsKeys {
  const item = record(itemInput);
  const products = record(item.shoplingProducts);
  const result = emptySeoShoplingGoodsKeys();
  for (const group of SEO_SHOPLING_GROUPS) {
    const product = record(products[CHANNEL_KEY_BY_GROUP[group]]);
    result[group] = text(product.goodsKey);
  }
  return result;
}

export function seoShoplingCanonicalMode(goodsKeys: SeoShoplingGoodsKeys) {
  const count = SEO_SHOPLING_GROUPS.filter((group) => /^\d+$/.test(goodsKeys[group])).length;
  if (count === 0) return "empty" as const;
  if (count === SEO_SHOPLING_GROUPS.length) return "complete" as const;
  return "partial" as const;
}

export function extractSeoShoplingGoodsKeys(rowsInput: unknown): SeoShoplingGoodsKeys {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  const result = emptySeoShoplingGoodsKeys();
  for (const value of rows) {
    const row = record(value);
    const succeeded = text(row.status) === "success" || text(row.code) === "000";
    if (!succeeded) continue;
    const group = GROUP_BY_CHANNEL_KEY[text(row.channel_key ?? row.channelKey)] || GROUP_BY_LABEL[text(row.channel ?? row.channel_label)];
    const goodsKey = text(row.goods_key ?? row.goodsKey);
    if (group && /^\d+$/.test(goodsKey)) result[group] = goodsKey;
  }
  const missing = SEO_SHOPLING_GROUPS.filter((group) => !/^\d+$/.test(result[group]));
  if (missing.length) {
    throw new Error(`샵플링 신규등록 결과에서 ${missing.join(", ")} goods_key를 확인하지 못했습니다.`);
  }
  if (new Set(Object.values(result)).size !== SEO_SHOPLING_GROUPS.length) {
    throw new Error("샵플링 신규등록 결과의 6개 goods_key가 서로 고유하지 않습니다.");
  }
  return result;
}

export function buildSeoShoplingRepeatedPtnGoodsCd(originalCode: string, dispatchId: string) {
  const normalized = text(originalCode).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const channelSuffix = /[A-F]$/.test(normalized) ? normalized.slice(-1) : "";
  const base = channelSuffix ? normalized.slice(0, -1) : normalized;
  const token = dispatchId.replace(/[^A-F0-9]/gi, "").slice(0, 8).toUpperCase();
  if (!base || !token) throw new Error("추가등록용 자사상품코드를 만들 수 없습니다.");
  const reservedLength = token.length + channelSuffix.length + 2;
  return `${base.slice(0, Math.max(1, 120 - reservedLength))}-S${token}${channelSuffix}`;
}

export function decorateSeoShoplingBulkPayload(
  payloadInput: ProductLaunchShoplingPayload,
  metadata: {
    dispatchId: string;
    ledgerId: string;
    reservationId: string;
    canonicalSeed: boolean;
  },
) {
  const payload = structuredClone(payloadInput) as ProductLaunchShoplingPayload & {
    seoBulk?: Record<string, unknown>;
  };
  if (!metadata.canonicalSeed) {
    payload.channels = payload.channels.map((channel) => ({
      ...channel,
      ptnGoodsCd: buildSeoShoplingRepeatedPtnGoodsCd(channel.ptnGoodsCd, metadata.dispatchId),
    }));
  }
  payload.seoBulk = {
    pipelineVersion: SEO_SHOPLING_LIVE_PIPELINE_VERSION,
    dispatchId: metadata.dispatchId,
    ledgerId: metadata.ledgerId,
    reservationId: metadata.reservationId,
    canonicalSeed: metadata.canonicalSeed,
  };
  return payload;
}

export function buildSeoShoplingDirectPlan(
  itemsInput: unknown,
  goodsKeys: SeoShoplingGoodsKeys,
) {
  const items = Array.isArray(itemsInput) ? itemsInput : [];
  const plan = items.map((value) => {
    const item = record(value);
    const group = text(item.product_group) as SeoShoplingGroup;
    if (!SEO_SHOPLING_GROUPS.includes(group)) throw new Error(`지원하지 않는 상품그룹입니다: ${group}`);
    const goodsKey = goodsKeys[group];
    const mallKey = text(item.mall_key);
    const finalTitle = text(item.title ?? item.final_title);
    const finalSiteSrch = text(item.common_search_line ?? item.final_site_srch);
    if (!/^\d+$/.test(goodsKey)) throw new Error(`${group} goods_key가 없습니다.`);
    if (!/^SMALL_\d{5}$/.test(mallKey)) throw new Error(`쇼핑몰ID가 올바르지 않습니다: ${mallKey}`);
    if (!finalTitle) throw new Error(`${group}/${mallKey} 상품명이 없습니다.`);
    if (!finalSiteSrch) throw new Error(`${group}/${mallKey} 검색어가 없습니다.`);
    return {
      goods_key: goodsKey,
      mall_key: mallKey,
      final_title: finalTitle,
      final_site_srch: finalSiteSrch,
    };
  });
  if (plan.length !== 29) throw new Error(`전체몰 1회 실행계획은 29개여야 합니다. 현재 ${plan.length}개입니다.`);
  const targets = new Set(plan.map((row) => `${row.goods_key}:${row.mall_key}`));
  if (targets.size !== plan.length) throw new Error("동일 goods_key/쇼핑몰ID가 중복되어 있습니다.");
  return plan;
}

export function seoShoplingDirectApplySucceeded(result: {
  status?: unknown;
  summary?: Record<string, unknown>;
}, expectedItems = 29) {
  const summary = record(result.summary);
  return (
    result.status === "success" &&
    summary.direct_apply_completed === true &&
    Number(summary.input_item_count) === expectedItems &&
    Number(summary.applied_item_count) === expectedItems &&
    Number(summary.failed_item_count) === 0 &&
    Number(summary.title_apply_success_count) === expectedItems &&
    Number(summary.search_apply_not_applied_count) === 0
  );
}

export async function readSeoShoplingLaunchState(
  context: SeoTitleLedgerContext,
  launchItemId: string,
) {
  const stateRow = await readProductLaunchState(context.config, context.identity.userId);
  const state = record(stateRow?.state_payload);
  const items = Array.isArray(state.items) ? state.items : [];
  const item = items.find((candidate) => text(record(candidate).id) === launchItemId);
  if (!item) throw new Error("상품출시 진행관리의 최신 저장본에서 상품을 찾지 못했습니다.");
  return { state, item: record(item), policy: state.policy };
}

export async function createSeoShoplingProductUploadJob(
  context: SeoTitleLedgerContext,
  input: {
    launchItemId: string;
    dispatchId: string;
    ledgerId: string;
    reservationId: string;
    canonicalSeed: boolean;
  },
) {
  const { item, policy } = await readSeoShoplingLaunchState(context, input.launchItemId);
  const jobId = randomUUID();
  const requestId = `seo-bulk-${Date.now()}-${jobId.slice(0, 8)}`;
  const basePayload = buildProductLaunchShoplingPayload(item, policy, requestId);
  const payload = decorateSeoShoplingBulkPayload(basePayload, {
    dispatchId: input.dispatchId,
    ledgerId: input.ledgerId,
    reservationId: input.reservationId,
    canonicalSeed: input.canonicalSeed,
  });
  const now = new Date().toISOString();
  const jobRow = {
    id: jobId,
    owner_id: context.identity.userId,
    owner_email: context.identity.email,
    launch_item_id: input.launchItemId,
    request_id: requestId,
    status: "queued",
    payload,
    created_at: now,
    updated_at: now,
  };
  const response = await fetch(
    `${context.config.supabaseUrl}/rest/v1/product_launch_upload_jobs`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(context.config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify(jobRow),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));

  const dispatch = await dispatchSeoShoplingProductLaunchWorkflow(jobId, requestId);
  if (!dispatch.ok) throw new Error(dispatch.message);
  return {
    jobId,
    requestId,
    actionsUrl: dispatch.actionsUrl,
    payload,
  };
}

async function dispatchSeoShoplingProductLaunchWorkflow(jobId: string, requestId: string) {
  const repo = process.env.SHOPLING_UPLOAD_REPO?.trim();
  const workflow = process.env.SHOPLING_LAUNCH_UPLOAD_WORKFLOW?.trim() || "shopling-product-launch-upload.yml";
  const ref = process.env.SHOPLING_UPLOAD_REF?.trim() || "main";
  const token = process.env.GITHUB_ACTIONS_TOKEN?.trim();
  const actionsUrl = repo ? `https://github.com/${repo}/actions/workflows/${encodeURIComponent(workflow)}` : undefined;
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo) || !token) {
    return { ok: false as const, message: "SHOPLING_UPLOAD_REPO와 GITHUB_ACTIONS_TOKEN 환경변수가 필요합니다.", actionsUrl };
  }
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref, inputs: { job_id: jobId, request_id: requestId } }),
      cache: "no-store",
    },
  );
  if (![200, 204].includes(response.status)) {
    return { ok: false as const, message: `GitHub Actions 실행 요청에 실패했습니다. status=${response.status}`, actionsUrl };
  }
  return { ok: true as const, actionsUrl };
}

export async function dispatchSeoShoplingDirectApply(items: unknown, goodsKeys: SeoShoplingGoodsKeys) {
  const plan = buildSeoShoplingDirectPlan(items, goodsKeys);
  const result = await dispatchKeywordShoplingDirectApply({
    execution_plan_json: JSON.stringify(plan),
    confirmation_text: KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
    max_items: plan.length,
  });
  if (result.status !== "queued" || !result.requestId) {
    throw new Error(result.message || "쇼핑몰별 상품명·검색어 반영을 시작하지 못했습니다.");
  }
  return { ...result, plan };
}
