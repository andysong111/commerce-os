import { NextRequest } from "next/server";
import { dispatchProductLaunchMallSeo } from "@/lib/productLaunchShoplingMallSeo";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const body = record(await request.json().catch(() => ({})));
  const itemId = text(body.itemId);
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
    const current = record(item.mallSeoApply);
    if (["pending", "running"].includes(text(current.status)) && text(current.requestId)) {
      return Response.json(
        {
          ok: false,
          code: "SHOPLING_MALL_SEO_ALREADY_RUNNING",
          message: "이미 쇼핑몰별 상품명 반영 작업이 진행 중입니다.",
          requestId: text(current.requestId),
        },
        { status: 409 },
      );
    }

    const started = await dispatchProductLaunchMallSeo(item);
    const now = new Date().toISOString();
    item.mallSeoApply = {
      status: "pending",
      requestId: started.requestId,
      itemCount: started.plan.length,
      message: "SEO Cloud 상품명 재고 29개를 쇼핑몰별로 반영 중입니다.",
      startedAt: now,
      updatedAt: now,
    };
    item.updatedAt = now;
    item.updatedBy = "SEO Cloud 쇼핑몰별 상품명";
    items[itemIndex] = item;
    await writeProductLaunchState(
      config.value,
      identity.value,
      { ...state, items, savedAt: now },
    );

    return Response.json({
      ok: true,
      status: "queued",
      requestId: started.requestId,
      itemCount: started.plan.length,
      runUrl: started.runUrl || started.githubActionsUrl || "",
      message: "쇼핑몰별 상품명 29개와 공통 검색어 10개 반영을 시작했습니다.",
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
