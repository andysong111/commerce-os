"use client";

import { useEffect, useState } from "react";

import SeoBulkInventoryReregisterBridge from "./SeoBulkInventoryReregisterBridge";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const V5_PREPARE_API = "/api/seo-title-ledger/prepare-v5";
const NORMALIZED_API = "/api/product-launch-tracker/normalized-optimized";

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
      ...new Set(
        items.map((value) => text(record(value).id)).filter(Boolean),
      ),
    ].slice(0, 50);
  } catch {
    return [];
  }
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as UnknownRecord;
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message || body.error) || `HTTP ${response.status}`);
  }
  return body;
}

async function patchSeoFinal(itemId: string, seoFinal: UnknownRecord) {
  await requestJson(NORMALIZED_API, {
    method: "PATCH",
    body: JSON.stringify({
      operation: "patch_item",
      itemId,
      patch: { seoFinal },
      updatedBy: "SEO v5 카테고리 의도 확장 자동준비",
    }),
  });
}

async function prepareV5(itemIds: string[]) {
  if (!itemIds.length) return { patchedCount: 0, expansionCount: 0 };
  const body = await requestJson(V5_PREPARE_API, {
    method: "POST",
    body: JSON.stringify({ itemIds }),
  });
  const results = Array.isArray(body.results) ? body.results.map(record) : [];
  let patchedCount = 0;
  let expansionCount = 0;
  for (const row of results) {
    expansionCount += Math.max(0, Number(row.expansionCount) || 0);
    const itemId = text(row.itemId);
    const seoFinal = record(row.seoFinal);
    if (!itemId || !Object.keys(seoFinal).length || row.registered === true) continue;
    await patchSeoFinal(itemId, seoFinal);
    patchedCount += 1;
  }
  return { patchedCount, expansionCount };
}

export default function SeoBulkInventoryReadyReregister() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(
    "카테고리 정합 연관검색어와 검색의도별 상품명 재고를 준비하고 있습니다.",
  );

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const prepared = await prepareV5(readBatchItemIds());
        if (disposed) return;
        if (prepared.patchedCount > 0) {
          setMessage(
            `미등록 상품 ${prepared.patchedCount}개의 v5 FINAL 저장 완료 · 새 결과를 다시 불러옵니다.`,
          );
          window.location.reload();
          return;
        }
        setMessage(
          `v5 상품명 재고 준비 완료 · 승인된 카테고리 확장재료 ${prepared.expansionCount}개 연결`,
        );
        setReady(true);
      } catch (prepareError) {
        if (!disposed) {
          setError(
            prepareError instanceof Error
              ? prepareError.message
              : "카테고리 의도 확장 v5 준비에 실패했습니다.",
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
        기등록 상품 추가등록을 잠갔습니다. 카테고리 의도 확장 v5 준비 실패 · {error}
      </section>
    );
  }
  if (!ready) {
    return (
      <section className="mx-auto mt-5 max-w-[1500px] rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-sm font-bold text-indigo-800">
        SEO v5 준비 중 · {message}
      </section>
    );
  }
  return (
    <>
      <section className="mx-auto mt-5 max-w-[1500px] rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-xs font-bold text-emerald-900">
        {message}. 다음 추가등록은 FINAL 10개를 anchor로 유지하면서 카테고리 Gate를 통과한 동의어·용도·상황·기능·형태·세부 카테고리 검색어를 분산 사용합니다. 기등록 카드 안의 과거 29개 제목은 이전 등록 스냅샷이며 다음 등록 재료로 재사용하지 않습니다.
      </section>
      <SeoBulkInventoryReregisterBridge />
    </>
  );
}
