"use client";

import { useEffect } from "react";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const NORMALIZED_API = "/api/product-launch-tracker/normalized-optimized";
const MALL_SEO_API = "/api/product-launch-tracker/shopling-mall-seo";
const CHECK_INTERVAL_MS = 6000;
const MAX_CONCURRENCY = 3;
const EXPECTED_GOODS_KEY_COUNT = 6;
const EXPECTED_MALL_TITLE_COUNT = 29;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function readBatchItemIds(): string[] {
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const items: unknown[] = Array.isArray(parsed?.items) ? parsed.items : [];
    const ids = items
      .map((value) => text(record(value).id))
      .filter((value): value is string => Boolean(value));
    return [...new Set<string>(ids)].slice(0, 50);
  } catch {
    return [];
  }
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
    cache: "no-store",
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

function mallTitleCount(item: UnknownRecord) {
  const seoFinal = record(item.seoFinal);
  return Array.isArray(seoFinal.mallTitles) ? seoFinal.mallTitles.length : 0;
}

async function mapLimit<T>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<void>,
) {
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

export default function SeoBulkMallSeoRecoveryBridge() {
  useEffect(() => {
    let disposed = false;
    let checking = false;
    let timer = 0;

    const check = async () => {
      if (checking || disposed) return;
      checking = true;
      try {
        const itemIds = readBatchItemIds();
        await mapLimit(itemIds, MAX_CONCURRENCY, async (itemId) => {
          if (disposed) return;
          try {
            const item = await readItem(itemId);
            if (
              goodsKeyCount(item) !== EXPECTED_GOODS_KEY_COUNT ||
              mallTitleCount(item) !== EXPECTED_MALL_TITLE_COUNT
            ) {
              return;
            }
            const mallSeo = record(item.mallSeoApply);
            const status = text(mallSeo.status);
            if (!["pending", "running", "failed"].includes(status)) return;

            await requestJson(MALL_SEO_API, {
              method: "POST",
              body: JSON.stringify({ itemId }),
            });
          } catch (error) {
            console.warn("[SEO bulk mall SEO recovery] reconciliation skipped", itemId, error);
          }
        });
      } finally {
        checking = false;
        if (!disposed) timer = window.setTimeout(() => void check(), CHECK_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(() => void check(), 1500);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
