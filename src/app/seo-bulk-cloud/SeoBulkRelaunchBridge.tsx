"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const NORMALIZED_API = "/api/product-launch-tracker/normalized-optimized";
const INVENTORY_SYNC_API = "/api/seo-title-ledger/sync";
const DISPATCH_API = "/api/seo-title-dispatch";
const FINALIZE_API = "/api/seo-title-dispatch/finalize";
const SHOPLING_UPLOAD_API = "/api/product-launch-tracker/shopling-upload";
const RELAUNCH_CONCURRENCY = 2;
const GROUP_CHANNEL_KEY: Record<string, string> = {
  도매1: "wholesale1",
  도매2: "wholesale2",
  도매3: "wholesale3",
  도매4: "wholesale4",
  소매1: "retail1",
  소매2: "retail2",
};

const GROUPS = Object.keys(GROUP_CHANNEL_KEY);

type UnknownRecord = Record<string, unknown>;
type BatchItem = {
  id: string;
  modelNumber?: string;
  productName?: string;
};
type BatchContext = {
  batchId: string;
  items: BatchItem[];
};
type RelaunchRow = {
  id: string;
  modelNumber: string;
  productName: string;
  item: UnknownRecord;
};
type ProgressState = {
  status: "idle" | "running" | "success" | "failed" | "partial";
  message: string;
};

type RelaunchReservation = {
  dispatchId: string;
  reservationId: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readBatch(): BatchContext | null {
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BatchContext;
    if (!text(parsed?.batchId) || !Array.isArray(parsed?.items)) return null;
    return {
      batchId: text(parsed.batchId),
      items: parsed.items
        .map((item) => ({
          id: text(item?.id),
          modelNumber: text(item?.modelNumber),
          productName: text(item?.productName),
        }))
        .filter((item) => item.id),
    };
  } catch {
    return null;
  }
}

function goodsKeyCount(item: UnknownRecord) {
  const products = record(item.shoplingProducts);
  return Object.values(products).filter((value) => text(record(value).goodsKey)).length;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

async function readLaunchItem(itemId: string) {
  const query = new URLSearchParams({ mode: "item", id: itemId });
  const body = await requestJson<{ ok?: boolean; item?: unknown }>(
    `${NORMALIZED_API}?${query.toString()}`,
  );
  const item = record(body.item);
  if (!text(item.id)) throw new Error("상품출시 진행관리 상품을 찾지 못했습니다.");
  return item;
}

async function patchLaunchItem(
  itemId: string,
  patch: UnknownRecord,
  updatedBy: string,
) {
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
  worker: (value: T, index: number) => Promise<void>,
) {
  let cursor = 0;
  async function runner() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await worker(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => runner()),
  );
}

function buildSeoFinalFromDispatch(
  item: UnknownRecord,
  ledger: UnknownRecord,
  executionPlan: unknown[],
) {
  const currentSeo = record(item.seoFinal);
  const plan = executionPlan.map(record);
  if (plan.length !== 29) {
    throw new Error(`상품명 재고 출고량이 ${plan.length}/29개라 재등록할 수 없습니다.`);
  }

  const groupProductNames: Record<string, string> = {};
  for (const group of GROUPS) {
    const title = text(plan.find((row) => text(row.product_group) === group)?.title);
    if (!title) throw new Error(`${group} 대표 상품명 재고가 없습니다.`);
    groupProductNames[GROUP_CHANNEL_KEY[group]] = title;
  }

  const searchKeywords = stringList(
    ledger.common_search_keywords ?? currentSeo.searchKeywords,
  ).slice(0, 10);
  if (searchKeywords.length !== 10) {
    throw new Error(`공통 검색어가 ${searchKeywords.length}/10개라 재등록할 수 없습니다.`);
  }

  return {
    productName:
      text(ledger.model_name) ||
      text(currentSeo.productName) ||
      text(item.productName),
    groupProductNames,
    searchKeywords,
    searchLine: searchKeywords.join(","),
    source: "seo-title-inventory-relaunch",
    sourceUrl: text(ledger.source_url) || text(currentSeo.sourceUrl),
    offerId: text(ledger.offer_id) || text(currentSeo.offerId),
    generatedAt: new Date().toISOString(),
    mallTitles: plan.map((row) => ({
      productGroup: text(row.product_group),
      marketName: text(row.market_name),
      mallKey: text(row.mall_key),
      accountIdLabel: text(row.account_id_label),
      title: text(row.title),
    })),
  };
}

function buildRelaunchHistory(item: UnknownRecord) {
  const now = new Date().toISOString();
  const history = Array.isArray(item.registrationResetHistory)
    ? clone(item.registrationResetHistory)
    : [];
  history.push({
    resetAt: now,
    resetBy: "SEO 상품명 재고 재등록",
    reason: "기존 상품 유지 · 상품명 재고 다음 회차 Shopling 추가등록",
    previousSelfCodeBase: text(item.selfCodeBase),
    previousProducts: clone(record(item.shoplingProducts)),
    previousStages: clone(record(item.stages)),
    previousSeoFinal: clone(record(item.seoFinal)),
  });
  return history.slice(-20);
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
    if (status === "queued" || status === "running") continue;
    if (status === "success" || status === "failed" || status === "partial_failure") {
      return { status, job };
    }
  }
  throw new Error("Shopling 재등록 결과 대기 시간이 초과되었습니다.");
}

async function releaseReservation(reservation: RelaunchReservation) {
  await requestJson<{ ok?: boolean }>(DISPATCH_API, {
    method: "POST",
    body: JSON.stringify({
      action: "release",
      reservationId: reservation.reservationId,
      dispatchId: reservation.dispatchId,
    }),
  }).catch(() => null);
}

async function finalizeReservation(
  reservation: RelaunchReservation,
  success: boolean,
) {
  await requestJson<{ ok?: boolean }>(FINALIZE_API, {
    method: "POST",
    body: JSON.stringify({
      dispatchId: reservation.dispatchId,
      reservationId: reservation.reservationId,
      success,
    }),
  });
}

async function restoreBeforeExternalWrite(
  rowId: string,
  snapshot: UnknownRecord | null,
) {
  if (!snapshot) return;
  await patchLaunchItem(
    rowId,
    {
      seoFinal: clone(record(snapshot.seoFinal)),
      selfCodeBase: text(snapshot.selfCodeBase),
      shoplingProducts: clone(record(snapshot.shoplingProducts)),
      registrationResetHistory: Array.isArray(snapshot.registrationResetHistory)
        ? clone(snapshot.registrationResetHistory)
        : [],
    },
    "SEO 상품명 재고 재등록 실패 복구",
  ).catch(() => null);
}

export default function SeoBulkRelaunchBridge() {
  const [rows, setRows] = useState<RelaunchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Record<string, ProgressState>>({});

  const refresh = useCallback(async () => {
    const batch = readBatch();
    if (!batch) {
      setRows([]);
      setLoading(false);
      return;
    }
    const loaded: RelaunchRow[] = [];
    await mapLimit(batch.items, 6, async (handoff) => {
      try {
        const item = await readLaunchItem(handoff.id);
        if (goodsKeyCount(item) > 0) {
          loaded.push({
            id: handoff.id,
            modelNumber: text(item.modelNumber) || text(handoff.modelNumber),
            productName: text(item.productName) || text(handoff.productName),
            item,
          });
        }
      } catch {
        // The main bulk client reports load errors. This bridge only lists relaunchable rows.
      }
    });
    loaded.sort((a, b) => a.modelNumber.localeCompare(b.modelNumber, "ko"));
    setRows(loaded);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== BATCH_STORAGE_KEY || busy) return;
      window.setTimeout(() => window.location.reload(), 120);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [busy, refresh]);

  const summary = useMemo(() => {
    const values = Object.values(progress);
    return {
      success: values.filter((row) => row.status === "success").length,
      failed: values.filter((row) => row.status === "failed").length,
      partial: values.filter((row) => row.status === "partial").length,
    };
  }, [progress]);

  const runRelaunch = useCallback(async () => {
    if (busy || !rows.length) return;
    const confirmed = window.confirm(
      [
        `${rows.length}개 기등록 상품을 상품명 재고 다음 회차로 추가등록합니다.`,
        "",
        "· 기존 Shopling/마켓 상품은 삭제하지 않습니다.",
        "· 상품명 재고 29개를 새로 예약합니다.",
        "· 새 자사상품코드로 Shopling 6채널 상품을 추가 생성합니다.",
        "· Shopling 등록 성공 후 쇼핑몰별 29개 상품명이 새 goods_key에 반영됩니다.",
        "· 성공한 상품명 재고만 사용완료 처리합니다.",
        "",
        "계속하시겠습니까?",
      ].join("\n"),
    );
    if (!confirmed) return;

    setBusy(true);
    setError("");
    setMessage("상품명 재고를 확인하고 기등록 상품 재등록을 준비합니다.");
    setProgress({});

    try {
      await requestJson<{ ok?: boolean }>(INVENTORY_SYNC_API, {
        method: "POST",
        body: JSON.stringify({ itemIds: rows.map((row) => row.id) }),
      });
      const listing = await requestJson<{
        ok?: boolean;
        ledgers?: unknown[];
      }>(DISPATCH_API);
      const ledgers = Array.isArray(listing.ledgers)
        ? listing.ledgers.map(record)
        : [];
      const ledgerByItem = new Map(
        ledgers
          .filter((ledger) => text(ledger.launch_item_id))
          .map((ledger) => [text(ledger.launch_item_id), ledger] as const),
      );

      await mapLimit(rows, RELAUNCH_CONCURRENCY, async (row) => {
        let reservation: RelaunchReservation | null = null;
        let snapshot: UnknownRecord | null = null;
        let prepared = false;
        let externalWriteStarted = false;
        setProgress((current) => ({
          ...current,
          [row.id]: { status: "running", message: "상품명 재고 29개 예약 중" },
        }));
        try {
          const item = await readLaunchItem(row.id);
          snapshot = clone(item);
          const ledger = ledgerByItem.get(row.id);
          if (!ledger) throw new Error("연결된 상품명 재고 원장을 찾지 못했습니다.");

          const reserved = await requestJson<{
            ok?: boolean;
            executionPlan?: unknown[];
            reservationId?: unknown;
            dispatchId?: unknown;
          }>(DISPATCH_API, {
            method: "POST",
            body: JSON.stringify({
              action: "reserve",
              ledgerId: text(ledger.ledger_id),
              rounds: 1,
            }),
          });
          reservation = {
            reservationId: text(reserved.reservationId),
            dispatchId: text(reserved.dispatchId),
          };
          if (!reservation.reservationId || !reservation.dispatchId) {
            throw new Error("상품명 재고 예약 ID를 받지 못했습니다.");
          }

          const seoFinal = buildSeoFinalFromDispatch(
            item,
            ledger,
            Array.isArray(reserved.executionPlan) ? reserved.executionPlan : [],
          );
          const registrationResetHistory = buildRelaunchHistory(item);
          setProgress((current) => ({
            ...current,
            [row.id]: { status: "running", message: "다음 회차 상품명 저장 중" },
          }));
          await patchLaunchItem(
            row.id,
            { seoFinal, registrationResetHistory },
            "SEO 상품명 재고 재등록 준비",
          );
          prepared = true;

          setProgress((current) => ({
            ...current,
            [row.id]: { status: "running", message: "새 자사상품코드로 Shopling 추가등록 중" },
          }));
          // From this point onward a network error can hide a successfully dispatched external write.
          // Treat any uncertain outcome as review-locked inventory instead of releasing it for reuse.
          externalWriteStarted = true;
          const started = await requestJson<{
            ok?: boolean;
            jobId?: unknown;
          }>(SHOPLING_UPLOAD_API, {
            method: "POST",
            body: JSON.stringify({ itemId: row.id, force: true }),
          });
          const jobId = text(started.jobId);
          if (!jobId) throw new Error("Shopling 재등록 작업 ID를 받지 못했습니다.");
          const outcome = await pollShoplingJob(jobId);

          if (outcome.status === "success") {
            await finalizeReservation(reservation, true);
            reservation = null;
            setProgress((current) => ({
              ...current,
              [row.id]: {
                status: "success",
                message: "추가등록 완료 · 상품명 재고 29개 사용완료",
              },
            }));
            return;
          }

          if (outcome.status === "partial_failure") {
            await finalizeReservation(reservation, false);
            reservation = null;
            setProgress((current) => ({
              ...current,
              [row.id]: {
                status: "partial",
                message: "일부 채널 등록됨 · 상품명 재고는 검토대기로 잠금",
              },
            }));
            return;
          }

          // A terminal full failure is known not to have produced a usable full round.
          // Return the reservation and restore the previous tracker view.
          externalWriteStarted = false;
          await releaseReservation(reservation);
          reservation = null;
          await restoreBeforeExternalWrite(row.id, snapshot);
          prepared = false;
          throw new Error(text(outcome.job.error_message) || "Shopling 재등록에 실패했습니다.");
        } catch (rowError) {
          let safetySuffix = "";
          if (reservation) {
            if (externalWriteStarted) {
              // Never put titles back into the available pool when Shopling may have accepted the job.
              await finalizeReservation(reservation, false).catch(() => null);
              safetySuffix = " · 외부 등록 결과 불명확: 상품명 재고를 검토대기로 잠금";
            } else {
              await releaseReservation(reservation);
              if (prepared) await restoreBeforeExternalWrite(row.id, snapshot);
            }
          }
          setProgress((current) => ({
            ...current,
            [row.id]: {
              status: "failed",
              message: `${
                rowError instanceof Error
                  ? rowError.message
                  : "기등록 상품 재등록에 실패했습니다."
              }${safetySuffix}`,
            },
          }));
        }
      });
      setMessage("기등록 상품 재등록 실행이 끝났습니다. 성공 건은 기존 상품을 유지한 채 새 상품으로 추가되었습니다.");
      await refresh();
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "기등록 상품 재등록을 시작하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, refresh, rows]);

  if (loading || !rows.length) return null;

  return (
    <section className="mx-auto mt-5 max-w-[1500px] px-5">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-sm font-black text-amber-950">
              기등록 상품 추가등록 · {rows.length}개
            </div>
            <p className="mt-1 text-xs font-semibold leading-5 text-amber-900">
              기존 판매상품은 유지하고 상품명 재고 다음 29개를 사용해 새 Shopling 상품을 추가 생성합니다.
              두 번 나눠 SEO 클라우드를 열어도 미실행 묶음은 누적됩니다.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runRelaunch()}
            className="rounded-xl bg-amber-700 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50"
          >
            {busy ? "기등록 상품 추가등록 중…" : `기등록 ${rows.length}개 추가등록`}
          </button>
        </div>
        {message ? (
          <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-bold text-rose-800 ring-1 ring-rose-200">
            {error}
          </div>
        ) : null}
        {Object.keys(progress).length ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => {
              const state = progress[row.id];
              if (!state) return null;
              return (
                <div key={row.id} className="rounded-lg bg-white px-3 py-2 ring-1 ring-amber-200">
                  <div className="text-xs font-black text-slate-900">
                    {row.modelNumber || row.productName || row.id}
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-slate-600">
                    {state.message}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {Object.keys(progress).length ? (
          <div className="mt-3 text-[11px] font-black text-amber-900">
            성공 {summary.success} · 일부실패 {summary.partial} · 실패 {summary.failed}
          </div>
        ) : null}
      </div>
    </section>
  );
}
