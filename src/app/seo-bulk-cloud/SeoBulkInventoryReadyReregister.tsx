"use client";

import { useEffect, useState } from "react";

import SeoBulkInventoryReregisterBridge from "./SeoBulkInventoryReregisterBridge";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const LEDGER_SYNC_API = "/api/seo-title-ledger/sync";

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

async function syncInventory(itemIds: string[]) {
  if (!itemIds.length) return;
  const response = await fetch(LEDGER_SYNC_API, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ itemIds }),
  });
  const body = (await response.json().catch(() => ({}))) as UnknownRecord;
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message || body.error) || `HTTP ${response.status}`);
  }
}

export default function SeoBulkInventoryReadyReregister() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        await syncInventory(readBatchItemIds());
        if (!disposed) setReady(true);
      } catch (syncError) {
        if (!disposed) {
          setError(
            syncError instanceof Error
              ? syncError.message
              : "상품명 재고 v4 동기화에 실패했습니다.",
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
        기등록 상품 추가등록을 잠갔습니다. FINAL 키워드 전용 30~50B 상품명 재고 동기화 실패 · {error}
      </section>
    );
  }
  if (!ready) {
    return (
      <section className="mx-auto mt-5 max-w-[1500px] rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-sm font-bold text-indigo-800">
        기등록 상품 추가등록 준비 중 · FINAL 키워드 전용 30~50B 상품명 재고를 확인하고 있습니다.
      </section>
    );
  }
  return <SeoBulkInventoryReregisterBridge />;
}
