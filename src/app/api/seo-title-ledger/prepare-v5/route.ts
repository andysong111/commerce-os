import { NextRequest } from "next/server";

import { generateKeywordElonBulkFinal } from "@/lib/keywordEngineElonBulkFinal";
import {
  seoTitleV5ExpansionPoolFromFinal,
  seoTitleV5ExpansionPoolFromLedger,
  syncSeoTitleBulkInventoryForItem,
} from "@/lib/seoTitleBulkInventorySync";
import {
  findSeoTitleLedgerByKey,
  requireSeoTitleLedgerContext,
} from "@/lib/seoTitleLedgerServer";
import { readProductLaunchNormalizedItem } from "@/lib/productLaunchTrackerNormalizedStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 500;

const MAX_ITEMS = 12;
const PREPARE_CONCURRENCY = 2;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function uniqueItemIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(text)
        .filter((itemId) => itemId && itemId.length <= 160),
    ),
  ].slice(0, MAX_ITEMS);
}

function goodsKeyCount(item: UnknownRecord) {
  return Object.values(record(item.shoplingProducts)).filter((value) =>
    Boolean(text(record(value).goodsKey)),
  ).length;
}

function firstSourceUrl(item: UnknownRecord) {
  const seoFinal = record(item.seoFinal);
  const direct = text(seoFinal.sourceUrl);
  if (direct) return direct;
  const links = Array.isArray(item.chinaProductLinks) ? item.chinaProductLinks : [];
  return links.map(text).find(Boolean) ?? "";
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>,
) {
  let cursor = 0;
  const result: R[] = [];
  async function runner() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await worker(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => runner()),
  );
  return result;
}

async function prepareOne(
  context: Awaited<ReturnType<typeof requireSeoTitleLedgerContext>> extends {
    ok: true;
    value: infer T;
  }
    ? T
    : never,
  itemId: string,
) {
  const item = record(
    await readProductLaunchNormalizedItem(
      context.config,
      context.identity.userId,
      itemId,
    ),
  );
  if (!text(item.id)) {
    return { itemId, ok: false, reason: "item_not_found" };
  }

  const count = goodsKeyCount(item);
  if (![0, 6].includes(count)) {
    return {
      itemId,
      ok: false,
      reason: `partial_goods_keys_${count}`,
      message: "Shopling goods_key가 0개 또는 6개인 상품만 v5 준비할 수 있습니다.",
    };
  }
  const registered = count === 6;
  const currentFinal = record(item.seoFinal);
  const currentPool = seoTitleV5ExpansionPoolFromFinal(currentFinal);
  const ledger = await findSeoTitleLedgerByKey(context, `launch:${itemId}`);
  const ledgerPool = seoTitleV5ExpansionPoolFromLedger(ledger);

  if (ledgerPool.length) {
    const stagedFinal = record(record(ledger?.source_payload).seoFinal);
    const sourceFinal = text(stagedFinal.productName) ? stagedFinal : currentFinal;
    const synced = await syncSeoTitleBulkInventoryForItem(context, itemId, {
      seoFinalOverride: sourceFinal,
      stagedForNextRegistration: registered,
    });
    return {
      itemId,
      ok: synced.synced,
      prepared: false,
      reusedLedgerPool: true,
      registered,
      expansionCount: ledgerPool.length,
      seoFinal: registered ? null : sourceFinal,
      sync: synced,
    };
  }

  if (currentPool.length) {
    const synced = await syncSeoTitleBulkInventoryForItem(context, itemId, {
      stagedForNextRegistration: false,
    });
    return {
      itemId,
      ok: synced.synced,
      prepared: false,
      reusedCurrentFinal: true,
      registered,
      expansionCount: currentPool.length,
      seoFinal: null,
      sync: synced,
    };
  }

  const modelNumber = text(item.modelNumber);
  const productName = text(item.productName);
  const category = text(item.shoplingCategory);
  const sourceUrl = firstSourceUrl(item);
  if (!productName || !category || !sourceUrl) {
    return {
      itemId,
      ok: false,
      reason: "v5_prepare_input_missing",
      message: `v5 준비 입력 부족 · 상품명 ${Boolean(productName)} · 카테고리 ${Boolean(category)} · 1688링크 ${Boolean(sourceUrl)}`,
    };
  }

  const generated = await generateKeywordElonBulkFinal({
    launchItemId: itemId,
    modelNumber,
    productName,
    sourceUrl,
    optionText: "",
    supportingText: [category, productName].filter(Boolean).join(" · "),
    mallTitleCategory: category,
    customBlockedTerms: [],
  });
  const generatedFinal = record(generated.seoFinal);
  const generatedPool = seoTitleV5ExpansionPoolFromFinal(generatedFinal);
  const synced = await syncSeoTitleBulkInventoryForItem(context, itemId, {
    seoFinalOverride: generatedFinal,
    stagedForNextRegistration: registered,
  });
  return {
    itemId,
    ok: synced.synced,
    prepared: true,
    registered,
    expansionCount: generatedPool.length,
    titleMaterialPolicy: text(generatedFinal.titleMaterialPolicy),
    seoFinal: registered ? null : generatedFinal,
    sync: synced,
  };
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const body = await request.json().catch(() => ({}));
  const itemIds = uniqueItemIds(
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as UnknownRecord).itemIds
      : [],
  );
  if (!itemIds.length) {
    return Response.json(
      {
        ok: false,
        code: "SEO_TITLE_V5_PREPARE_ITEM_IDS_REQUIRED",
        message: "v5로 준비할 상품 ID가 필요합니다.",
      },
      { status: 400 },
    );
  }

  const context = authenticated.value;
  const results = await mapLimit(itemIds, PREPARE_CONCURRENCY, async (itemId) => {
    try {
      return await prepareOne(context, itemId);
    } catch (error) {
      return {
        itemId,
        ok: false,
        reason: error instanceof Error ? error.message : "v5 준비 실패",
      };
    }
  });
  const failed = results.filter((row) => row.ok !== true);
  return Response.json({
    ok: failed.length === 0,
    requestedCount: itemIds.length,
    preparedCount: results.filter((row) => row.ok === true).length,
    failedCount: failed.length,
    results,
    ...(failed.length
      ? {
          message: failed
            .map((row) => `${text(row.itemId)}: ${text(row.reason) || "준비 실패"}`)
            .join(" · "),
        }
      : {}),
  }, { status: failed.length ? 409 : 200 });
}
