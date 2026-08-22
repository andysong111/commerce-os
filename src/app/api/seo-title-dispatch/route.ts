import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "@/lib/productGroupMarketRegistry";
import {
  SEO_TITLE_FULL_MARKET_SIZE,
  SEO_TITLE_GROUP_QUOTAS,
  SEO_TITLE_MAX_ROUNDS,
  type SeoTitleProductGroup,
} from "@/lib/seoTitleInventoryGenerator";
import {
  callSeoTitleRpc,
  insertSeoTitleDispatch,
  insertSeoTitleDispatchItems,
  listSeoTitleDispatches,
  listSeoTitleLedgers,
  patchSeoTitleDispatch,
  patchSeoTitleDispatchItems,
  readProductLaunchItemForSeo,
  readSeoTitleDispatchItems,
  readSeoTitleLedger,
  requireSeoTitleLedgerContext,
} from "@/lib/seoTitleLedgerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

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

const GROUP_CHANNEL_KEY: Record<SeoTitleProductGroup, string> = {
  도매1: "wholesale1",
  도매2: "wholesale2",
  도매3: "wholesale3",
  도매4: "wholesale4",
  소매1: "retail1",
  소매2: "retail2",
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function integer(value: unknown, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readShoplingGoodsKeys(item: UnknownRecord | null) {
  const itemPayload = record(item?.item_payload);
  const products = record(itemPayload.shoplingProducts);
  return Object.fromEntries(
    (Object.keys(GROUP_CHANNEL_KEY) as SeoTitleProductGroup[]).map((group) => {
      const channel = record(products[GROUP_CHANNEL_KEY[group]]);
      return [group, text(channel.goodsKey)];
    }),
  ) as Record<SeoTitleProductGroup, string>;
}

function groupCounts(rounds: number) {
  return Object.fromEntries(
    (Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]).map(
      (group) => [group, SEO_TITLE_GROUP_QUOTAS[group] * rounds],
    ),
  ) as Record<SeoTitleProductGroup, number>;
}

function buildExecutionPlan(input: {
  dispatchId: string;
  rounds: number;
  commonSearchLine: string;
  goodsKeys: Record<SeoTitleProductGroup, string>;
  reserved: ReservedTitle[];
}) {
  const byGroup = new Map<SeoTitleProductGroup, ReservedTitle[]>();
  for (const group of Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]) {
    byGroup.set(
      group,
      input.reserved
        .filter((row) => row.product_group === group)
        .sort(
          (left, right) =>
            Number(right.quality_score) - Number(left.quality_score) ||
            left.title.localeCompare(right.title, "ko"),
        ),
    );
  }

  const plan: Array<Record<string, unknown>> = [];
  for (let round = 1; round <= input.rounds; round += 1) {
    for (const market of PRODUCT_GROUP_MARKET_REGISTRY) {
      const group = market.productGroup as SeoTitleProductGroup;
      const titleRow = byGroup.get(group)?.shift();
      if (!titleRow) {
        throw new Error(`${group} 예약 상품명이 부족해 출고 계획을 만들 수 없습니다.`);
      }
      plan.push({
        dispatch_id: input.dispatchId,
        registration_round: round,
        title_id: titleRow.title_id,
        ledger_id: titleRow.ledger_id,
        product_group: group,
        market_name: market.marketName,
        mall_key: market.mallKey,
        account_id_label: market.accountIdLabel,
        goods_key: input.goodsKeys[group],
        title: titleRow.title,
        common_search_line: input.commonSearchLine,
        quality_score: Number(titleRow.quality_score) || 0,
        source_materials: Array.isArray(titleRow.source_materials)
          ? titleRow.source_materials
          : [],
      });
    }
  }
  return plan;
}

export async function GET(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const mode = request.nextUrl.searchParams.get("mode") || "list";

  try {
    if (mode === "dispatch") {
      const dispatchId = text(request.nextUrl.searchParams.get("dispatchId"));
      if (!dispatchId) {
        return Response.json(
          { ok: false, code: "SEO_TITLE_DISPATCH_ID_REQUIRED", message: "출고 계획 ID가 필요합니다." },
          { status: 400 },
        );
      }
      const dispatches = await listSeoTitleDispatches(context, { limit: 100 });
      const dispatch = dispatches.find(
        (row) => text(row.dispatch_id) === dispatchId,
      );
      if (!dispatch) {
        return Response.json(
          { ok: false, code: "SEO_TITLE_DISPATCH_NOT_FOUND", message: "출고 계획을 찾지 못했습니다." },
          { status: 404 },
        );
      }
      const items = await readSeoTitleDispatchItems(context, dispatchId);
      return Response.json({ ok: true, dispatch, items });
    }

    const [ledgers, dispatches] = await Promise.all([
      listSeoTitleLedgers(context, {
        search: request.nextUrl.searchParams.get("search") || "",
        limit: 200,
      }),
      listSeoTitleDispatches(context, { limit: 50 }),
    ]);
    return Response.json({
      ok: true,
      ledgers,
      dispatches,
      fullMarketSize: SEO_TITLE_FULL_MARKET_SIZE,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SEO_TITLE_DISPATCH_READ_FAILED",
        message: error instanceof Error ? error.message : "SEO 출고센터를 읽지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const input = record(await request.json().catch(() => ({})));
  const action = text(input.action);

  if (action === "release") {
    const reservationId = text(input.reservationId);
    const dispatchId = text(input.dispatchId);
    if (!reservationId || !dispatchId) {
      return Response.json(
        { ok: false, code: "SEO_TITLE_RESERVATION_REQUIRED", message: "해제할 예약 정보가 필요합니다." },
        { status: 400 },
      );
    }
    try {
      const affected = await callSeoTitleRpc<number>(
        context,
        "release_seo_title_reservation",
        {
          p_owner_id: context.identity.userId,
          p_reservation_id: reservationId,
        },
      );
      await Promise.all([
        patchSeoTitleDispatch(context, dispatchId, {
          status: "cancelled",
          completed_at: new Date().toISOString(),
        }),
        patchSeoTitleDispatchItems(context, dispatchId, {
          status: "cancelled",
        }),
      ]);
      return Response.json({ ok: true, affected: Number(affected) || 0 });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          code: "SEO_TITLE_RESERVATION_RELEASE_FAILED",
          message: error instanceof Error ? error.message : "상품명 예약을 해제하지 못했습니다.",
        },
        { status: 400 },
      );
    }
  }

  if (action !== "reserve") {
    return Response.json(
      { ok: false, code: "SEO_TITLE_DISPATCH_ACTION_INVALID", message: "지원하지 않는 출고 작업입니다." },
      { status: 400 },
    );
  }

  const ledgerId = text(input.ledgerId);
  const rounds = Math.max(
    1,
    Math.min(SEO_TITLE_MAX_ROUNDS, integer(input.rounds, 1)),
  );
  if (!ledgerId) {
    return Response.json(
      { ok: false, code: "SEO_TITLE_LEDGER_ID_REQUIRED", message: "출고할 상품명 원장을 선택하세요." },
      { status: 400 },
    );
  }

  const reservationId = randomUUID();
  const dispatchId = randomUUID();
  let reservationCreated = false;
  try {
    const detail = await readSeoTitleLedger(context, ledgerId);
    if (!detail?.ledger || !detail.stats) {
      throw new Error("출고할 상품명 원장을 찾지 못했습니다.");
    }
    const launchItemId = text(detail.ledger.launch_item_id);
    if (!launchItemId) {
      return Response.json(
        {
          ok: false,
          code: "SEO_TITLE_LAUNCH_ITEM_NOT_LINKED",
          message: "상품출시 진행관리 상품과 연결된 원장만 샵플링 출고 계획을 만들 수 있습니다.",
        },
        { status: 409 },
      );
    }
    const launchItem = await readProductLaunchItemForSeo(
      context,
      launchItemId,
    );
    if (!launchItem) {
      return Response.json(
        {
          ok: false,
          code: "SEO_TITLE_LAUNCH_ITEM_NOT_FOUND",
          message: "연결된 상품출시 진행관리 상품을 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }
    const goodsKeys = readShoplingGoodsKeys(launchItem);
    const missingGroups = (
      Object.keys(goodsKeys) as SeoTitleProductGroup[]
    ).filter((group) => !goodsKeys[group]);
    if (missingGroups.length) {
      return Response.json(
        {
          ok: false,
          code: "SHOPLING_GOODS_KEYS_NOT_READY",
          message:
            "샵플링 기본상품 등록이 완료된 뒤 SEO 상품명 출고 계획을 만들 수 있습니다.",
          missingGroups,
        },
        { status: 409 },
      );
    }

    const requestedCounts = groupCounts(rounds);
    const availableChecks: Array<[SeoTitleProductGroup, number]> = [
      ["도매1", Number(detail.stats.available_wholesale1) || 0],
      ["도매2", Number(detail.stats.available_wholesale2) || 0],
      ["도매3", Number(detail.stats.available_wholesale3) || 0],
      ["도매4", Number(detail.stats.available_wholesale4) || 0],
      ["소매1", Number(detail.stats.available_retail1) || 0],
      ["소매2", Number(detail.stats.available_retail2) || 0],
    ];
    const shortage = availableChecks
      .filter(([group, available]) => available < requestedCounts[group])
      .map(([group, available]) => ({
        productGroup: group,
        available,
        required: requestedCounts[group],
      }));
    if (shortage.length) {
      return Response.json(
        {
          ok: false,
          code: "SEO_TITLE_INVENTORY_SHORTAGE",
          message: "상품명 재고가 부족합니다. 원장에서 먼저 보충하세요.",
          shortage,
        },
        { status: 409 },
      );
    }

    const reserved = await callSeoTitleRpc<ReservedTitle[]>(
      context,
      "reserve_seo_title_inventory",
      {
        p_owner_id: context.identity.userId,
        p_ledger_id: ledgerId,
        p_group_counts: requestedCounts,
        p_reservation_id: reservationId,
        p_ttl_minutes: 30,
      },
    );
    reservationCreated = true;
    if (!Array.isArray(reserved) || reserved.length !== SEO_TITLE_FULL_MARKET_SIZE * rounds) {
      throw new Error("예약된 상품명 수량이 요청한 전체몰 출고 수량과 일치하지 않습니다.");
    }

    const plan = buildExecutionPlan({
      dispatchId,
      rounds,
      commonSearchLine: detail.ledger.common_search_line,
      goodsKeys,
      reserved,
    });
    const expiry = reserved[0]?.reservation_expires_at ?? null;
    const dispatch = await insertSeoTitleDispatch(context, {
      dispatch_id: dispatchId,
      ledger_id: ledgerId,
      reservation_id: reservationId,
      launch_item_id: launchItemId,
      dispatch_kind: "shopling_prepare",
      status: "ready",
      registration_rounds: rounds,
      requested_title_count: SEO_TITLE_FULL_MARKET_SIZE * rounds,
      reserved_title_count: reserved.length,
      common_search_line: detail.ledger.common_search_line,
      execution_plan: plan,
      result_payload: {
        mode: "plan_only",
        externalWriteExecuted: false,
        note:
          "v1 출고센터는 원장 재고 예약과 샵플링 실행 계획 생성까지만 수행합니다.",
      },
      reservation_expires_at: expiry,
    });
    if (!dispatch) throw new Error("SEO 출고 계획 원장을 저장하지 못했습니다.");

    const items = await insertSeoTitleDispatchItems(
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
        status: "ready",
      })),
    );

    return Response.json({
      ok: true,
      dispatch,
      items,
      executionPlan: plan,
      reservationId,
      dispatchId,
      externalWriteExecuted: false,
    });
  } catch (error) {
    if (reservationCreated) {
      await callSeoTitleRpc<number>(
        context,
        "release_seo_title_reservation",
        {
          p_owner_id: context.identity.userId,
          p_reservation_id: reservationId,
        },
      ).catch(() => null);
    }
    return Response.json(
      {
        ok: false,
        code: "SEO_TITLE_DISPATCH_RESERVE_FAILED",
        message: error instanceof Error ? error.message : "SEO 출고 계획을 만들지 못했습니다.",
      },
      { status: 400 },
    );
  }
}
