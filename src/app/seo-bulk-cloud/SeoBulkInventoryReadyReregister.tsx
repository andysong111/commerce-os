"use client";

import { useEffect, useState } from "react";

import SeoBulkInventoryReregisterBridge from "./SeoBulkInventoryReregisterBridge";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const CUSTOM_BLOCKED_STORAGE_KEY = "keywordEngineElonLab.step4.customBlockedTerms.v1";
const NORMALIZED_API = "/api/product-launch-tracker/normalized-optimized";
const KEYWORD_API = "/api/keyword-engine-elon-lab";
const LEDGER_SYNC_API = "/api/seo-title-ledger/sync";
const PREPARE_CONCURRENCY = 2;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function readBatchItemIds() {
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const items: unknown[] = Array.isArray(parsed?.items) ? parsed.items : [];
    return [
      ...new Set(items.map((value) => text(record(value).id)).filter(Boolean)),
    ].slice(0, 50);
  } catch {
    return [];
  }
}

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean).slice(0, 120) : [];
  } catch {
    return [];
  }
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as UnknownRecord;
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message || body.error) || `HTTP ${response.status}`);
  }
  return body;
}

async function readItem(itemId: string) {
  const query = new URLSearchParams({ mode: "item", id: itemId });
  const body = await requestJson(`${NORMALIZED_API}?${query.toString()}`);
  return record(body.item);
}

function goodsKeyCount(item: UnknownRecord) {
  return Object.values(record(item.shoplingProducts)).filter((value) =>
    Boolean(text(record(value).goodsKey)),
  ).length;
}

function optionTextFromItem(item: UnknownRecord) {
  const options = Array.isArray(item.orderOptions) ? item.orderOptions.map(record) : [];
  return options
    .map((row) =>
      [text(row.saleOption), text(row.chinaOption), text(row.optionName), text(row.barcode)]
        .filter(Boolean)
        .join(" / "),
    )
    .filter(Boolean)
    .join("\n");
}

function sourceUrlFromItem(item: UnknownRecord) {
  const seoFinal = record(item.seoFinal);
  const links = Array.isArray(item.chinaProductLinks)
    ? item.chinaProductLinks.map(text).filter(Boolean)
    : [];
  return text(seoFinal.sourceUrl) || links[0] || "";
}

function preparedExpansion(item: UnknownRecord) {
  const meta = record(item.seoTitleExpansionV5);
  return Number(meta.version) === 5 && Array.isArray(meta.pool);
}

async function patchExpansion(itemId: string, metadata: UnknownRecord) {
  await requestJson(NORMALIZED_API, {
    method: "PATCH",
    body: JSON.stringify({
      operation: "patch_item",
      itemId,
      patch: { seoTitleExpansionV5: metadata },
      updatedBy: "SEO 카테고리 정합 TITLE 확장 준비",
    }),
  });
}

async function prepareLegacyRegisteredItem(
  itemId: string,
  customBlockedTerms: string[],
) {
  const item = await readItem(itemId);
  if (goodsKeyCount(item) !== 6 || preparedExpansion(item)) return false;

  const category = text(item.shoplingCategory);
  const sourceUrl = sourceUrlFromItem(item);
  if (!category) throw new Error(`${text(item.modelNumber) || itemId}: Shopling 카테고리가 없습니다.`);
  if (!sourceUrl) throw new Error(`${text(item.modelNumber) || itemId}: 1688 상품 링크가 없습니다.`);

  const body = await requestJson(KEYWORD_API, {
    method: "POST",
    body: JSON.stringify({
      action: "generate_bulk_final",
      item: {
        launchItemId: itemId,
        modelNumber: text(item.modelNumber),
        productName: text(item.productName),
        sourceUrl,
        optionText: optionTextFromItem(item),
        supportingText: [text(item.productName), text(item.modelNumber)]
          .filter(Boolean)
          .join(" · "),
        mallTitleCategory: category,
      },
      customBlockedTerms,
    }),
  });
  const result = record(body.result);
  const seoFinal = record(result.seoFinal);
  const pool = Array.isArray(seoFinal.titleExpansionPool)
    ? seoFinal.titleExpansionPool
    : [];
  await patchExpansion(itemId, {
    version: 5,
    category,
    pool,
    preparedAt: new Date().toISOString(),
    source: "category-intent-expansion-v5-legacy-reregister-prep",
    titleMaterialPolicy: text(seoFinal.titleMaterialPolicy) ||
      (pool.length
        ? "final10-plus-category-aligned-expansion-v5"
        : "final10-only-v5-fallback"),
  });
  return true;
}

async function mapLimit<T>(values: T[], limit: number, worker: (value: T) => Promise<void>) {
  let cursor = 0;
  async function runner() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await worker(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => runner()),
  );
}

async function prepareExpansion(itemIds: string[]) {
  const customBlockedTerms = readCustomBlockedTerms();
  await mapLimit(itemIds, PREPARE_CONCURRENCY, async (itemId) => {
    await prepareLegacyRegisteredItem(itemId, customBlockedTerms);
  });
}

async function syncInventory(itemIds: string[]) {
  if (!itemIds.length) return;
  const body = await requestJson(LEDGER_SYNC_API, {
    method: "POST",
    body: JSON.stringify({ itemIds }),
  });
  const results = Array.isArray(body.results) ? body.results.map(record) : [];
  const blocked = results.find((row) =>
    ["category_intent_expansion_not_prepared", "inventory_upgrade_deferred_active_reservation"].includes(
      text(row.reason),
    ),
  );
  if (blocked) {
    throw new Error(
      `${text(blocked.modelNumber) || text(blocked.itemId)}: 카테고리 정합 상품명 재고 준비가 완료되지 않았습니다.`,
    );
  }
}

export default function SeoBulkInventoryReadyReregister() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const itemIds = readBatchItemIds();
        await prepareExpansion(itemIds);
        await syncInventory(itemIds);
        if (!disposed) setReady(true);
      } catch (syncError) {
        if (!disposed) {
          setError(
            syncError instanceof Error
              ? syncError.message
              : "카테고리 정합 상품명 재고 준비에 실패했습니다.",
          );
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  if (error) {
    return (
      <section className="mx-auto mt-5 max-w-[1500px] rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-800">
        기등록 상품 추가등록을 잠갔습니다. 카테고리 정합 TITLE 확장 재고 준비 실패 · {error}
      </section>
    );
  }
  if (!ready) {
    return (
      <section className="mx-auto mt-5 max-w-[1500px] rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-sm font-bold text-indigo-800">
        기등록 상품 추가등록 준비 중 · 기존 STEP2~4 후보를 다시 평가해 카테고리 정합 TITLE 확장 재고를 만들고 있습니다.
      </section>
    );
  }
  return (
    <>
      <section className="mx-auto mt-5 max-w-[1500px] rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-xs font-bold text-emerald-900">
        다음 추가등록은 FINAL 검색어 10개 + 카테고리 정합 TITLE 확장 후보를 사용합니다. 상품출시 페이지의 이미지경로·작업자명·상세HTML은 상품명 재료로 사용하지 않습니다.
      </section>
      <SeoBulkInventoryReregisterBridge />
    </>
  );
}
