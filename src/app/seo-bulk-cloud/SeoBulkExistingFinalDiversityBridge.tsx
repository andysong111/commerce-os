"use client";

import { useEffect } from "react";

import { composeKeywordElonSafeMallTitles } from "@/lib/keywordEngineElonMallTitleSafeComposer";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "@/lib/productGroupMarketRegistry";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const NORMALIZED_API = "/api/product-launch-tracker/normalized-optimized";
const SESSION_PREFIX = "commerceOs.seoBulkCloud.diversityRepair.v2:";

type UnknownRecord = Record<string, unknown>;

type BatchContext = {
  batchId?: string;
  items?: Array<{ id?: string }>;
};

type MallTitle = {
  productGroup: string;
  marketName: string;
  mallKey: string;
  accountIdLabel: string;
  title: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function stringList(value: unknown, limit = 100) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = text(entry);
    const key = normalized.toLocaleLowerCase().replace(/\s+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function readBatch() {
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as BatchContext) : null;
    if (!parsed?.batchId || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function batchItemIds(batch: BatchContext) {
  return [
    ...new Set(
      (batch.items ?? [])
        .map((item) => text(item?.id))
        .filter(Boolean),
    ),
  ].slice(0, 50);
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

function hasRegisteredGoodsKeys(item: UnknownRecord) {
  const products = record(item.shoplingProducts);
  return Object.values(products).some((value) => text(record(value).goodsKey));
}

function readMallTitles(value: unknown): MallTitle[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = record(entry);
      return {
        productGroup: text(row.productGroup),
        marketName: text(row.marketName),
        mallKey: text(row.mallKey),
        accountIdLabel: text(row.accountIdLabel),
        title: text(row.title),
      };
    })
    .filter((row) => row.productGroup && row.title);
}

function canonical(value: unknown) {
  return text(value).toLocaleLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function needsDiversityRepair(mallTitles: MallTitle[]) {
  // Re-evaluate every complete, unregistered legacy FINAL once. Old finals can have
  // 29 exact-unique titles and still contain weak/unsafe material or poor diversity.
  // sameTitles() below prevents unnecessary writes when the SAFE result is unchanged.
  return mallTitles.length === 29;
}

function safeOptionText(item: UnknownRecord) {
  const options = Array.isArray(item.orderOptions) ? item.orderOptions.map(record) : [];
  if (!options.length) return "";
  if (options.length === 1) {
    return [text(options[0].optionName), text(options[0].saleOption)]
      .filter(Boolean)
      .join(" / ");
  }
  // Multiple choices must not turn one option value (for example one color) into
  // a product-wide title claim. Keep only shared option labels.
  return [...new Set(options.map((option) => text(option.optionName)).filter(Boolean))]
    .join(" / ");
}

function sameTitles(left: MallTitle[], right: MallTitle[]) {
  if (left.length !== right.length) return false;
  return left.every((row, index) => canonical(row.title) === canonical(right[index]?.title));
}

async function repairItem(itemId: string) {
  const item = await readItem(itemId);
  if (!text(item.id) || hasRegisteredGoodsKeys(item)) return false;

  const seoFinal = record(item.seoFinal);
  const modelName = text(seoFinal.productName);
  const searchKeywords = stringList(seoFinal.searchKeywords, 20);
  const mallTitles = readMallTitles(seoFinal.mallTitles);
  if (!modelName || !searchKeywords.length || !needsDiversityRepair(mallTitles)) {
    return false;
  }

  const detailAsset = record(item.detailPageAsset);
  const composed = composeKeywordElonSafeMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: searchKeywords,
    modelName,
    context: {
      modelNumber: text(item.modelNumber),
      productName: text(item.productName) || modelName,
      category: text(item.shoplingCategory),
      optionText: safeOptionText(item),
      detailHtml: text(detailAsset.html),
      mainImageUrl: text(detailAsset.mainImageUrl),
      additionalImageUrls: stringList(detailAsset.additionalImageUrls, 5),
    },
  });
  const repaired: MallTitle[] = composed.rows.map((row) => ({
    productGroup: row.productGroup,
    marketName: row.marketName,
    mallKey: row.mallKey,
    accountIdLabel: row.accountIdLabel,
    title: row.title,
  }));
  if (sameTitles(mallTitles, repaired)) return false;

  const groupTitles: Record<string, string> = {};
  const groupKeyByLabel: Record<string, string> = {
    도매1: "wholesale1",
    도매2: "wholesale2",
    도매3: "wholesale3",
    도매4: "wholesale4",
    소매1: "retail1",
    소매2: "retail2",
  };
  for (const [label, key] of Object.entries(groupKeyByLabel)) {
    const title = repaired.find((row) => row.productGroup === label)?.title;
    if (title) groupTitles[key] = title;
  }

  await requestJson(NORMALIZED_API, {
    method: "PATCH",
    body: JSON.stringify({
      operation: "patch_item",
      itemId,
      patch: {
        seoFinal: {
          ...seoFinal,
          mallTitles: repaired,
          groupProductNames: groupTitles,
          diversityRepair: {
            version: 2,
            composer: "safe-final-keyword-coverage-v2",
            uniqueTitleCount: composed.uniqueTitleCount,
            nearDuplicateCount: composed.nearDuplicateCount,
            keywordCoverageCount: composed.keywordCoverageCount,
            keywordCoverageTotal: composed.keywordCoverageTotal,
            repairedAt: new Date().toISOString(),
          },
        },
      },
      updatedBy: "SEO 쇼핑몰 상품명 SAFE 중복 자동보정",
    }),
  });
  return true;
}

export default function SeoBulkExistingFinalDiversityBridge() {
  useEffect(() => {
    const batch = readBatch();
    if (!batch?.batchId) return;
    const sessionKey = `${SESSION_PREFIX}${batch.batchId}`;
    if (window.sessionStorage.getItem(sessionKey) === "done") return;

    let cancelled = false;
    void (async () => {
      const itemIds = batchItemIds(batch);
      if (!itemIds.length) {
        window.sessionStorage.setItem(sessionKey, "done");
        return;
      }

      let repairedCount = 0;
      for (const itemId of itemIds) {
        if (cancelled) return;
        try {
          if (await repairItem(itemId)) repairedCount += 1;
        } catch (error) {
          console.warn(`[SEO bulk safe diversity repair] ${itemId} skipped`, error);
        }
      }
      if (cancelled) return;
      window.sessionStorage.setItem(sessionKey, "done");
      if (repairedCount > 0) {
        window.location.reload();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
