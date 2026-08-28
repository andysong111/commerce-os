import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  canonicalPricePolicyResultMessage,
  extractCanonicalPriceTargetsFromTrackerItem,
  isCanonicalPricePolicyResultSuccess,
  isCanonicalPricePolicyResultTerminalFailure,
  SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
} from "@/lib/shoplingCanonicalPricePolicy";
import {
  dispatchShoplingPriceModifyActions,
  fetchShoplingPriceModifyActionsResult,
} from "@/lib/shoplingPriceModifyRunner";
import {
  dispatchProductLaunchMallSeo,
} from "@/lib/productLaunchShoplingMallSeo";
import {
  fetchKeywordShoplingDirectApplyResult,
} from "@/lib/keywordShoplingDirectApplyRunner";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readResponseJson,
  writeProductLaunchState,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

const MAX_ITEMS_PER_PULSE = 3;
const MAX_POSTPROCESS_RETRIES = 2;
const EXPECTED_MALL_TITLE_COUNT = 29;

type UnknownRecord = Record<string, unknown>;

type TrackerStateRow = {
  owner_id: string;
  owner_email: string;
  state_payload: UnknownRecord;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function completeMallSeoResult(value: unknown) {
  const result = record(value);
  const summary = record(result.summary);
  return (
    text(result.status) === "success" &&
    summary.direct_apply_completed === true &&
    numeric(summary.title_apply_success_count) >= EXPECTED_MALL_TITLE_COUNT
  );
}

function terminalMallSeoFailure(value: unknown) {
  const result = record(value);
  const status = text(result.status).toLowerCase();
  const phase = text(result.phase).toLowerCase();
  return ["error", "failed", "blocked", "partial_failure"].includes(status) ||
    ["failed", "completed_no_artifact"].includes(phase);
}

export function isSeoRunShoplingPostprocessCandidate(itemInput: unknown) {
  const item = record(itemInput);
  const dispatch = record(item.seoRunDispatch);
  if (text(dispatch.status) !== "success" || !text(dispatch.seoRunId)) return false;
  const targets = extractCanonicalPriceTargetsFromTrackerItem(item);
  if (targets.goodsKeys.length !== 6 || targets.failedRowCount > 0) return false;
  const priceStatus = text(record(item.pricePolicy).status);
  const mallStatus = text(record(item.mallSeoApply).status);
  return priceStatus !== "success" || mallStatus !== "success";
}

async function readTrackerStates(config: ProductLaunchAdminConfig) {
  const params = new URLSearchParams({
    select: "owner_id,owner_email,state_payload",
    order: "updated_at.desc",
    limit: "20",
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  return (Array.isArray(body) ? body : [])
    .map((row) => record(row))
    .map((row) => ({
      owner_id: text(row.owner_id),
      owner_email: text(row.owner_email),
      state_payload: record(row.state_payload),
    }))
    .filter((row) => row.owner_id) as TrackerStateRow[];
}

async function advancePricePolicy(item: UnknownRecord, now: string) {
  const targets = extractCanonicalPriceTargetsFromTrackerItem(item);
  if (targets.goodsKeys.length !== 6 || targets.failedRowCount > 0) return false;

  const current = record(item.pricePolicy);
  const currentStatus = text(current.status);
  const requestId = text(current.requestId);

  if (currentStatus === "success") return false;

  if (["pending", "running"].includes(currentStatus) && requestId) {
    const actual = await fetchShoplingPriceModifyActionsResult(requestId);
    if (isCanonicalPricePolicyResultSuccess(actual, targets.goodsKeys.length)) {
      item.pricePolicy = {
        ...current,
        required: true,
        status: "success",
        requestId,
        policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
        goodsKeyCount: targets.goodsKeys.length,
        completedAt: now,
        message: "중앙 가격정책 적용과 검증을 완료했습니다.",
        updatedAt: now,
      };
      return true;
    }
    if (isCanonicalPricePolicyResultTerminalFailure(actual)) {
      item.pricePolicy = {
        ...current,
        required: true,
        status: "failed",
        requestId,
        policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
        goodsKeyCount: targets.goodsKeys.length,
        message: canonicalPricePolicyResultMessage(actual),
        failedAt: now,
        updatedAt: now,
      };
      return true;
    }
    item.pricePolicy = {
      ...current,
      required: true,
      status: "pending",
      requestId,
      policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
      goodsKeyCount: targets.goodsKeys.length,
      message: "중앙 가격정책 적용 결과를 기다리고 있습니다.",
      updatedAt: now,
    };
    return true;
  }

  const retryCount = Math.max(0, Math.floor(numeric(current.retryCount)));
  if (currentStatus === "failed" && retryCount >= MAX_POSTPROCESS_RETRIES) return false;

  const dispatch = await dispatchShoplingPriceModifyActions(
    targets.goodsKeys.join(","),
    [],
    targets.goodsKeyGroupJson,
  );
  if (dispatch.status === "queued" && dispatch.requestId) {
    item.pricePolicy = {
      ...current,
      required: true,
      status: "pending",
      requestId: dispatch.requestId,
      previousRequestId: requestId,
      retryCount: currentStatus === "failed" ? retryCount + 1 : retryCount,
      policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
      goodsKeyCount: targets.goodsKeys.length,
      message: "상품등록 후 누락된 쇼핑몰별 판매가 적용을 시작했습니다.",
      startedAt: now,
      updatedAt: now,
    };
    return true;
  }

  item.pricePolicy = {
    ...current,
    required: true,
    status: "failed",
    requestId: dispatch.requestId ?? "",
    retryCount: currentStatus === "failed" ? retryCount + 1 : retryCount,
    policyVersion: SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
    goodsKeyCount: targets.goodsKeys.length,
    message: dispatch.message || "중앙 가격정책 실행을 시작하지 못했습니다.",
    failedAt: now,
    updatedAt: now,
  };
  return true;
}

async function advanceMallSeo(item: UnknownRecord, now: string) {
  const current = record(item.mallSeoApply);
  const currentStatus = text(current.status);
  const requestId = text(current.requestId);
  if (currentStatus === "success") return false;

  if (["pending", "running"].includes(currentStatus) && requestId) {
    const actual = await fetchKeywordShoplingDirectApplyResult(requestId);
    if (completeMallSeoResult(actual)) {
      item.mallSeoApply = {
        ...current,
        status: "success",
        requestId,
        itemCount: EXPECTED_MALL_TITLE_COUNT,
        message: "SEO Cloud 쇼핑몰별 상품명 29개와 검색어 10개 반영 완료",
        completedAt: now,
        updatedAt: now,
      };
      return true;
    }
    if (terminalMallSeoFailure(actual)) {
      item.mallSeoApply = {
        ...current,
        status: "failed",
        requestId,
        itemCount: EXPECTED_MALL_TITLE_COUNT,
        message: text(record(actual).message) || "쇼핑몰별 상품명 반영 결과를 확인하세요.",
        failedAt: now,
        updatedAt: now,
      };
      return true;
    }
    item.mallSeoApply = {
      ...current,
      status: "pending",
      requestId,
      itemCount: EXPECTED_MALL_TITLE_COUNT,
      message: "쇼핑몰별 상품명 29개와 검색어 10개 반영 결과를 기다리고 있습니다.",
      updatedAt: now,
    };
    return true;
  }

  const retryCount = Math.max(0, Math.floor(numeric(current.retryCount)));
  if (currentStatus === "failed" && retryCount >= MAX_POSTPROCESS_RETRIES) return false;

  try {
    const dispatch = await dispatchProductLaunchMallSeo(item);
    item.mallSeoApply = {
      ...current,
      status: "pending",
      requestId: dispatch.requestId,
      previousRequestId: requestId,
      itemCount: dispatch.plan.length,
      retryCount: currentStatus === "failed" ? retryCount + 1 : retryCount,
      message: "상품등록 후 누락된 쇼핑몰별 상품명 29개와 검색어 10개 반영을 시작했습니다.",
      startedAt: now,
      updatedAt: now,
    };
    return true;
  } catch (error) {
    item.mallSeoApply = {
      ...current,
      status: "failed",
      requestId: "",
      retryCount: currentStatus === "failed" ? retryCount + 1 : retryCount,
      itemCount: EXPECTED_MALL_TITLE_COUNT,
      message: error instanceof Error ? error.message : "쇼핑몰별 상품명 반영을 시작하지 못했습니다.",
      failedAt: now,
      updatedAt: now,
    };
    return true;
  }
}

async function persistState(
  config: ProductLaunchAdminConfig,
  row: TrackerStateRow,
  state: UnknownRecord,
  itemIds: string[],
) {
  const identity: ProductLaunchIdentity = {
    userId: row.owner_id,
    email: row.owner_email,
  };
  await writeProductLaunchState(config, identity, state);
  if (itemIds.length) {
    await reconcileProductLaunchNormalizedAfterLegacyItems(
      config,
      identity,
      [...new Set(itemIds)],
    );
  }
}

export async function processProductLaunchShoplingPostprocessQueue(options: {
  maxItems?: number;
} = {}) {
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    throw new Error("상품출시 후처리 저장소가 설정되지 않았습니다.");
  }
  const config = configResult.value;
  const maxItems = Math.max(1, Math.min(10, Math.floor(options.maxItems ?? MAX_ITEMS_PER_PULSE)));
  const states = await readTrackerStates(config);
  let processedCount = 0;
  let dispatchedPriceCount = 0;
  let dispatchedMallSeoCount = 0;
  let completedPriceCount = 0;
  let completedMallSeoCount = 0;

  for (const row of states) {
    if (processedCount >= maxItems) break;
    const state = record(row.state_payload);
    const items = Array.isArray(state.items) ? state.items.map((item) => record(item)) : [];
    const changedIds: string[] = [];

    for (const item of items) {
      if (processedCount >= maxItems) break;
      if (!isSeoRunShoplingPostprocessCandidate(item)) continue;

      const beforePrice = text(record(item.pricePolicy).status);
      const beforeMall = text(record(item.mallSeoApply).status);
      const now = new Date().toISOString();
      const priceChanged = await advancePricePolicy(item, now);
      const mallChanged = await advanceMallSeo(item, now);
      const afterPrice = text(record(item.pricePolicy).status);
      const afterMall = text(record(item.mallSeoApply).status);

      if (priceChanged || mallChanged) {
        item.updatedAt = now;
        item.updatedBy = "Shopling 등록 후처리 Worker";
        changedIds.push(text(item.id));
      }
      if (!beforePrice && afterPrice === "pending") dispatchedPriceCount += 1;
      if (!beforeMall && afterMall === "pending") dispatchedMallSeoCount += 1;
      if (beforePrice !== "success" && afterPrice === "success") completedPriceCount += 1;
      if (beforeMall !== "success" && afterMall === "success") completedMallSeoCount += 1;
      processedCount += 1;
    }

    if (changedIds.length) {
      state.items = items;
      state.savedAt = new Date().toISOString();
      await persistState(config, row, state, changedIds);
    }
  }

  return {
    processedCount,
    dispatchedPriceCount,
    dispatchedMallSeoCount,
    completedPriceCount,
    completedMallSeoCount,
  };
}
