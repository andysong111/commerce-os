import { NextRequest } from "next/server";
import {
  fetchKeywordShoplingDirectApplyResult,
} from "@/lib/keywordShoplingDirectApplyRunner";
import { dispatchProductLaunchMallSeo } from "@/lib/productLaunchShoplingMallSeo";
import { reconcileProductLaunchNormalizedAfterLegacyItems } from "@/lib/productLaunchTrackerNormalizedLegacyReconcile";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_MALL_TITLE_COUNT = 29;
const MAX_AUTO_RETRY_COUNT = 2;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function completeMallSeoResult(result: UnknownRecord) {
  const summary = record(result.summary);
  return (
    text(result.status) === "success" &&
    summary.direct_apply_completed === true &&
    Number(summary.title_apply_success_count ?? 0) >= EXPECTED_MALL_TITLE_COUNT
  );
}

async function persistItem(
  config: { supabaseUrl: string; secretKey: string },
  identity: { userId: string; email: string },
  state: UnknownRecord,
  items: UnknownRecord[],
  itemIndex: number,
  item: UnknownRecord,
  itemId: string,
) {
  const now = new Date().toISOString();
  item.updatedAt = now;
  item.updatedBy = "SEO Cloud 쇼핑몰별 상품명";
  items[itemIndex] = item;
  await writeProductLaunchState(
    config,
    identity,
    { ...state, items, savedAt: now },
  );
  await reconcileProductLaunchNormalizedAfterLegacyItems(
    config,
    identity,
    [itemId],
  );
  return now;
}

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const body = record(await request.json().catch(() => ({})));
  const itemId = text(body.itemId);
  const forceRetry = body.forceRetry === true;
  if (!itemId || itemId.length > 160) {
    return Response.json(
      { ok: false, code: "INVALID_ITEM_ID", message: "상품 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const stateRow = await readProductLaunchState(
      config.value,
      identity.value.userId,
    );
    const state = record(stateRow?.state_payload);
    const items = Array.isArray(state.items) ? state.items.map(record) : [];
    const itemIndex = items.findIndex((item) => text(item.id) === itemId);
    if (itemIndex < 0) {
      return Response.json(
        { ok: false, code: "PRODUCT_LAUNCH_ITEM_NOT_FOUND", message: "상품출시 진행관리 상품을 찾지 못했습니다." },
        { status: 404 },
      );
    }

    const item = { ...items[itemIndex] };
    let current = record(item.mallSeoApply);
    const currentStatus = text(current.status);
    const currentRequestId = text(current.requestId);

    if (currentStatus === "success" && Number(current.itemCount ?? 0) >= EXPECTED_MALL_TITLE_COUNT) {
      return Response.json({
        ok: true,
        status: "success",
        requestId: currentRequestId,
        itemCount: Number(current.itemCount ?? EXPECTED_MALL_TITLE_COUNT),
        message: "쇼핑몰별 상품명 29개 반영이 이미 완료되었습니다.",
      });
    }

    if (["pending", "running"].includes(currentStatus) && currentRequestId) {
      const actual = record(
        await fetchKeywordShoplingDirectApplyResult(currentRequestId),
      );
      if (text(actual.status) === "pending") {
        return Response.json({
          ok: true,
          status: "pending",
          requestId: currentRequestId,
          itemCount: Number(current.itemCount ?? EXPECTED_MALL_TITLE_COUNT),
          runUrl: text(actual.runUrl),
          message: "기존 쇼핑몰별 상품명 반영 작업이 아직 진행 중입니다.",
        });
      }
      if (completeMallSeoResult(actual)) {
        const now = new Date().toISOString();
        item.mallSeoApply = {
          ...current,
          status: "success",
          requestId: currentRequestId,
          itemCount: EXPECTED_MALL_TITLE_COUNT,
          message: "SEO Cloud 쇼핑몰별 상품명 29개 반영 완료",
          completedAt: now,
          updatedAt: now,
        };
        await persistItem(
          config.value,
          identity.value,
          state,
          items,
          itemIndex,
          item,
          itemId,
        );
        return Response.json({
          ok: true,
          status: "success",
          requestId: currentRequestId,
          itemCount: EXPECTED_MALL_TITLE_COUNT,
          runUrl: text(actual.runUrl),
          message: "쇼핑몰별 상품명 29개와 공통 검색어 10개 반영을 확인했습니다.",
        });
      }

      const now = new Date().toISOString();
      item.mallSeoApply = {
        ...current,
        status: "failed",
        requestId: currentRequestId,
        itemCount: Number(current.itemCount ?? EXPECTED_MALL_TITLE_COUNT),
        message:
          text(actual.message) ||
          "기존 쇼핑몰별 상품명 반영 작업이 종료됐지만 완전 성공을 확인하지 못했습니다.",
        failedPhase: text(actual.phase),
        failedAt: now,
        updatedAt: now,
      };
      await persistItem(
        config.value,
        identity.value,
        state,
        items,
        itemIndex,
        item,
        itemId,
      );
      current = record(item.mallSeoApply);
    }

    const retryCount = Math.max(0, Number(current.retryCount ?? 0) || 0);
    if (text(current.status) === "failed" && retryCount >= MAX_AUTO_RETRY_COUNT && !forceRetry) {
      return Response.json(
        {
          ok: false,
          code: "SHOPLING_MALL_SEO_RETRY_LIMIT_REACHED",
          message: `쇼핑몰별 상품명 자동 재시도 ${MAX_AUTO_RETRY_COUNT}회를 모두 사용했습니다. 수동 확인 후 다시 실행하세요.`,
          requestId: text(current.requestId),
          retryCount,
        },
        { status: 409 },
      );
    }

    const started = await dispatchProductLaunchMallSeo(item);
    const now = new Date().toISOString();
    const isRetry = Boolean(currentRequestId) || text(current.status) === "failed";
    item.mallSeoApply = {
      ...current,
      status: "pending",
      requestId: started.requestId,
      previousRequestId: currentRequestId || text(current.requestId),
      itemCount: started.plan.length,
      retryCount: isRetry ? retryCount + 1 : retryCount,
      message: "SEO Cloud 상품명 재고 29개를 쇼핑몰별로 반영 중입니다.",
      startedAt: now,
      updatedAt: now,
    };
    await persistItem(
      config.value,
      identity.value,
      state,
      items,
      itemIndex,
      item,
      itemId,
    );

    return Response.json({
      ok: true,
      status: "queued",
      requestId: started.requestId,
      itemCount: started.plan.length,
      retryCount: Number(record(item.mallSeoApply).retryCount ?? 0),
      runUrl: started.runUrl || started.githubActionsUrl || "",
      message: isRetry
        ? "중단된 기존 작업을 정리하고 쇼핑몰별 상품명 29개 자동 재시도를 시작했습니다."
        : "쇼핑몰별 상품명 29개와 공통 검색어 10개 반영을 시작했습니다.",
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_MALL_SEO_START_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "쇼핑몰별 상품명 반영을 시작하지 못했습니다.",
      },
      { status: 400 },
    );
  }
}
