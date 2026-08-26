"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const NORMALIZED_API = "/api/product-launch-tracker/normalized-optimized";
const LEDGER_API = "/api/seo-title-ledger";
const LEDGER_SYNC_API = "/api/seo-title-ledger/sync";
const DISPATCH_API = "/api/seo-title-dispatch";
const FINALIZE_API = "/api/seo-title-dispatch/finalize";
const SHOPLING_UPLOAD_API = "/api/product-launch-tracker/shopling-upload";
const CHANNELS = [
  ["도매1", "wholesale1"],
  ["도매2", "wholesale2"],
  ["도매3", "wholesale3"],
  ["도매4", "wholesale4"],
  ["소매1", "retail1"],
  ["소매2", "retail2"],
] as const;
const REREGISTER_CONCURRENCY = 2;

type UnknownRecord = Record<string, unknown>;
type BatchItem = {
  id: string;
  modelNumber: string;
  productName: string;
};
type EligibleItem = BatchItem & {
  item: UnknownRecord;
  goodsKeyCount: number;
};
type Progress = {
  status: "idle" | "running" | "success" | "failed";
  message: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readBatchItems(): BatchItem[] {
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return array(parsed?.items)
      .map((value) => {
        const row = record(value);
        return {
          id: text(row.id),
          modelNumber: text(row.modelNumber),
          productName: text(row.productName),
        };
      })
      .filter((row) => row.id);
  } catch {
    return [];
  }
}

async function requestJson<T extends UnknownRecord>(url: string, init?: RequestInit) {
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
  const body = (await response.json().catch(() => ({}))) as T;
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message || body.error) || `요청 실패 · HTTP ${response.status}`);
  }
  return body;
}

async function readItem(itemId: string) {
  const query = new URLSearchParams({ mode: "item", id: itemId });
  const body = await requestJson<{ ok?: boolean; item?: unknown }>(
    `${NORMALIZED_API}?${query.toString()}`,
  );
  return record(body.item);
}

function goodsKeyCount(item: UnknownRecord) {
  const products = record(item.shoplingProducts);
  return Object.values(products).filter((value) => text(record(value).goodsKey)).length;
}

async function patchItem(itemId: string, patch: UnknownRecord, updatedBy: string) {
  await requestJson<{ ok?: boolean }>(NORMALIZED_API, {
    method: "PATCH",
    body: JSON.stringify({
      operation: "patch_item",
      itemId,
      patch,
      updatedBy,
    }),
  });
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

async function findLedger(itemId: string, modelNumber: string) {
  async function read() {
    const query = new URLSearchParams({ search: modelNumber, limit: "50" });
    const body = await requestJson<{ ok?: boolean; ledgers?: unknown }>(
      `${LEDGER_API}?${query.toString()}`,
    );
    return array(body.ledgers)
      .map(record)
      .find((row) => text(row.launch_item_id) === itemId);
  }

  let ledger = await read();
  if (ledger) return ledger;
  await requestJson<{ ok?: boolean }>(LEDGER_SYNC_API, {
    method: "POST",
    body: JSON.stringify({ itemIds: [itemId] }),
  });
  ledger = await read();
  if (!ledger) {
    throw new Error(`${modelNumber || itemId}: 상품명 재고 원장을 찾지 못했습니다.`);
  }
  return ledger;
}

async function readLedgerDetail(ledgerId: string) {
  const query = new URLSearchParams({ mode: "detail", ledgerId });
  return requestJson<{
    ok?: boolean;
    ledger?: unknown;
    stats?: unknown;
    inventory?: unknown;
  }>(`${LEDGER_API}?${query.toString()}`);
}

function buildSeoFinal(detail: UnknownRecord, executionPlan: UnknownRecord[]) {
  const ledger = record(detail.ledger);
  const commonSearchKeywords = array(ledger.common_search_keywords)
    .map(text)
    .filter(Boolean)
    .slice(0, 10);
  if (commonSearchKeywords.length !== 10) {
    throw new Error("상품명 원장의 공통 검색어가 정확히 10개가 아닙니다.");
  }
  if (executionPlan.length !== 29) {
    throw new Error(`상품명 재고 출고 수량이 29개가 아닙니다. 현재 ${executionPlan.length}개`);
  }

  const groupProductNames: Record<string, string> = {};
  for (const [group, channel] of CHANNELS) {
    const title = executionPlan.find((row) => text(row.product_group) === group)?.title;
    if (!text(title)) throw new Error(`${group} 기준 상품명이 없습니다.`);
    groupProductNames[channel] = text(title);
  }

  return {
    productName: text(ledger.model_name),
    groupProductNames,
    searchKeywords: commonSearchKeywords,
    searchLine: commonSearchKeywords.join(","),
    source: "seo-title-inventory-reregister",
    sourceUrl: text(ledger.source_url),
    offerId: text(ledger.offer_id),
    generatedAt: new Date().toISOString(),
    mallTitles: executionPlan.map((row) => ({
      productGroup: text(row.product_group),
      marketName: text(row.market_name),
      mallKey: text(row.mall_key),
      accountIdLabel: text(row.account_id_label),
      title: text(row.title),
    })),
  };
}

function nextSelfCode() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 10);
  return `PLR${(random || Date.now().toString(36)).toUpperCase()}`.slice(0, 54);
}

async function pollShoplingJob(jobId: string) {
  for (let poll = 0; poll < 120; poll += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, poll === 0 ? 1500 : 5000));
    const query = new URLSearchParams({ jobId });
    const body = await requestJson<{ ok?: boolean; job?: unknown }>(
      `${SHOPLING_UPLOAD_API}?${query.toString()}`,
    );
    const job = record(body.job);
    const status = text(job.status);
    if (status === "success") return job;
    if (status === "failed" || status === "partial_failure") {
      throw new Error(text(job.error_message) || `Shopling 재등록 ${status}`);
    }
  }
  throw new Error("Shopling 재등록 결과 대기 시간이 초과되었습니다.");
}

export default function SeoBulkInventoryReregisterBridge() {
  const [eligible, setEligible] = useState<EligibleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const batchItems = readBatchItems();
    if (!batchItems.length) {
      setEligible([]);
      setLoading(false);
      return;
    }
    const next: EligibleItem[] = [];
    await mapLimit(batchItems, 6, async (batchItem) => {
      try {
        const item = await readItem(batchItem.id);
        const count = goodsKeyCount(item);
        if (count === 6) next.push({ ...batchItem, item, goodsKeyCount: count });
      } catch {
        // Main SEO client already surfaces item-load failures.
      }
    });
    next.sort((a, b) => a.modelNumber.localeCompare(b.modelNumber, "ko"));
    setEligible(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const successCount = useMemo(
    () => Object.values(progress).filter((row) => row.status === "success").length,
    [progress],
  );

  const runOne = useCallback(async (target: EligibleItem) => {
    const model = target.modelNumber || target.id;
    const original = await readItem(target.id);
    if (goodsKeyCount(original) !== 6) {
      throw new Error(`${model}: 기존 Shopling 6채널 등록이 완전하지 않아 추가등록을 중단했습니다.`);
    }

    setProgress((current) => ({
      ...current,
      [target.id]: { status: "running", message: "상품명 재고 29개 예약 중" },
    }));

    const ledger = await findLedger(target.id, target.modelNumber);
    const ledgerId = text(ledger.ledger_id);
    const detail = await readLedgerDetail(ledgerId);
    const stats = record(detail.stats);
    if (Number(stats.full_market_rounds_available ?? 0) < 1) {
      throw new Error(`${model}: 추가등록 가능한 상품명 재고 1회차(29개)가 부족합니다.`);
    }

    const reserved = await requestJson<{
      ok?: boolean;
      executionPlan?: unknown;
      reservationId?: unknown;
      dispatchId?: unknown;
    }>(DISPATCH_API, {
      method: "POST",
      body: JSON.stringify({ action: "reserve", ledgerId, rounds: 1 }),
    });
    const reservationId = text(reserved.reservationId);
    const dispatchId = text(reserved.dispatchId);
    const executionPlan = array(reserved.executionPlan).map(record);
    if (!reservationId || !dispatchId) {
      throw new Error(`${model}: 상품명 재고 예약 ID를 받지 못했습니다.`);
    }

    const previousProducts = record(original.shoplingProducts);
    const previousSeoFinal = record(original.seoFinal);
    const previousSelfCodeBase = text(original.selfCodeBase);
    const previousStages = record(original.stages);
    const previousHistory = array(original.shoplingRegistrationHistory).map(record);
    const newSelfCodeBase = nextSelfCode();
    const historyEntry = {
      registrationType: "seo_inventory_append",
      status: "reserved",
      archivedAt: new Date().toISOString(),
      previousSelfCodeBase,
      previousProducts,
      previousSeoFinal,
      dispatchId,
      reservationId,
    };

    try {
      const seoFinal = buildSeoFinal(record(detail), executionPlan);
      setProgress((current) => ({
        ...current,
        [target.id]: { status: "running", message: "새 상품명 29개 적용 · 추가등록 준비" },
      }));
      await patchItem(
        target.id,
        {
          seoFinal,
          selfCodeBase: newSelfCodeBase,
          shoplingRegistrationHistory: [...previousHistory, historyEntry],
          seoInventoryDispatch: {
            status: "reserved",
            dispatchId,
            reservationId,
            newSelfCodeBase,
            preparedAt: new Date().toISOString(),
          },
        },
        "SEO 상품명 재고 추가등록",
      );

      const started = await requestJson<{
        ok?: boolean;
        jobId?: unknown;
        requestId?: unknown;
      }>(SHOPLING_UPLOAD_API, {
        method: "POST",
        body: JSON.stringify({ itemId: target.id, force: true }),
      });
      const jobId = text(started.jobId);
      const requestId = text(started.requestId);
      if (!jobId) throw new Error(`${model}: Shopling 추가등록 작업 ID가 없습니다.`);

      setProgress((current) => ({
        ...current,
        [target.id]: { status: "running", message: "Shopling 6채널 추가등록 중" },
      }));
      const job = await pollShoplingJob(jobId);
      await requestJson<{ ok?: boolean }>(FINALIZE_API, {
        method: "POST",
        body: JSON.stringify({
          reservationId,
          dispatchId,
          success: true,
          externalRequestId: requestId,
          resultPayload: { jobId, shoplingStatus: text(job.status) },
        }),
      });
      const refreshed = await readItem(target.id);
      const refreshedHistory = array(refreshed.shoplingRegistrationHistory).map(record);
      const completedHistory = refreshedHistory.map((entry) =>
        text(entry.dispatchId) === dispatchId
          ? { ...entry, status: "success", completedAt: new Date().toISOString(), jobId }
          : entry,
      );
      await patchItem(
        target.id,
        {
          shoplingRegistrationHistory: completedHistory,
          seoInventoryDispatch: {
            status: "success",
            dispatchId,
            reservationId,
            jobId,
            completedAt: new Date().toISOString(),
          },
        },
        "SEO 상품명 재고 추가등록 완료",
      );
      setProgress((current) => ({
        ...current,
        [target.id]: { status: "success", message: "새 6채널 추가등록 완료 · 재고 29개 사용처리" },
      }));
    } catch (runError) {
      const detailMessage = runError instanceof Error ? runError.message : "추가등록 실패";
      await requestJson<{ ok?: boolean }>(FINALIZE_API, {
        method: "POST",
        body: JSON.stringify({
          reservationId,
          dispatchId,
          success: false,
          errorMessage: detailMessage,
        }),
      }).catch(() => null);
      const failedHistory = [...previousHistory, {
        ...historyEntry,
        status: "failed",
        failedAt: new Date().toISOString(),
        error: detailMessage,
      }];
      await patchItem(
        target.id,
        {
          shoplingProducts: previousProducts,
          seoFinal: previousSeoFinal,
          selfCodeBase: previousSelfCodeBase,
          stages: previousStages,
          shoplingRegistrationHistory: failedHistory,
          seoInventoryDispatch: {
            status: "failed",
            dispatchId,
            reservationId,
            failedAt: new Date().toISOString(),
            error: detailMessage,
          },
        },
        "SEO 상품명 재고 추가등록 실패복구",
      ).catch(() => null);
      throw runError;
    }
  }, []);

  const runAll = useCallback(async () => {
    if (!eligible.length || running) return;
    const confirmed = window.confirm(
      `${eligible.length}개 기등록 상품을 다시 Shopling에 추가등록합니다.\n\n각 상품마다 상품명 재고 29개를 새로 사용하고 새 6채널 goods_key를 생성합니다. Shopling 등록 후 실제 마켓 판매상품으로 전송되는 운영 흐름이므로 중복 판매상품이 생성됩니다.\n\n계속하시겠습니까?`,
    );
    if (!confirmed) return;
    setRunning(true);
    setMessage(`${eligible.length}개 상품 추가등록을 시작했습니다.`);
    setError("");
    await mapLimit(eligible, REREGISTER_CONCURRENCY, async (target) => {
      try {
        await runOne(target);
      } catch (runError) {
        const detail = runError instanceof Error ? runError.message : "추가등록 실패";
        setProgress((current) => ({
          ...current,
          [target.id]: { status: "failed", message: detail },
        }));
      }
    });
    setRunning(false);
    setMessage("기등록 상품 추가등록 작업이 끝났습니다. 실패 상품은 기존 등록상태로 복구했습니다.");
    await refresh();
  }, [eligible, refresh, runOne, running]);

  if (loading || !eligible.length) return null;

  return (
    <section className="mx-auto mt-5 max-w-[1500px] rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-slate-900 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.14em] text-indigo-700">
            SEO 상품명 재고 · 기등록 상품 추가등록
          </div>
          <div className="mt-1 text-sm font-bold text-slate-700">
            현재 묶음에 이미 Shopling 6채널 등록된 상품 {eligible.length}개 · 추가등록 시 상품당 재고 29개를 새로 사용합니다.
          </div>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={() => void runAll()}
          className="rounded-xl bg-indigo-700 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40"
        >
          {running ? "기등록 상품 추가등록 중…" : `기등록 상품 다시 등록 (${eligible.length})`}
        </button>
      </div>
      {message ? <div className="mt-3 text-xs font-bold text-indigo-900">{message}</div> : null}
      {error ? <div className="mt-3 text-xs font-bold text-rose-700">{error}</div> : null}
      {Object.keys(progress).length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {eligible.map((item) => {
            const row = progress[item.id];
            if (!row) return null;
            return (
              <div key={item.id} className="rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-indigo-100">
                <strong>{item.modelNumber || item.id}</strong>
                <span className="ml-2 text-slate-600">{row.message}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      {successCount ? (
        <div className="mt-3 text-xs font-black text-emerald-700">이번 실행 추가등록 성공 {successCount}건</div>
      ) : null}
    </section>
  );
}
