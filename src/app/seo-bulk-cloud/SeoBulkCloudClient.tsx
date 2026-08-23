"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const CUSTOM_BLOCKED_STORAGE_KEY =
  "keywordEngineElonLab.step4.customBlockedTerms.v1";
const NORMALIZED_API = "/api/product-launch-tracker/normalized-optimized";
const KEYWORD_API = "/api/keyword-engine-elon-lab";
const SHOPLING_UPLOAD_API = "/api/product-launch-tracker/shopling-upload";
const GENERATION_CONCURRENCY = 3;
const REGISTRATION_CONCURRENCY = 3;

const GROUPS = [
  ["wholesale1", "도매1"],
  ["wholesale2", "도매2"],
  ["wholesale3", "도매3"],
  ["wholesale4", "도매4"],
  ["retail1", "소매1"],
  ["retail2", "소매2"],
] as const;

type UnknownRecord = Record<string, unknown>;
type HandoffItem = {
  id: string;
  trackerRowNumber: number;
  modelNumber: string;
  productName: string;
  sourceUrl: string;
};
type BatchContext = {
  version: number;
  batchId: string;
  createdAt: string;
  autoStart?: boolean;
  items: HandoffItem[];
};
type MallTitle = {
  productGroup: string;
  marketName: string;
  mallKey: string;
  accountIdLabel: string;
  title: string;
};
type SeoFinal = {
  productName: string;
  groupProductNames: Record<string, string>;
  searchKeywords: string[];
  searchLine: string;
  source: string;
  sourceUrl: string;
  offerId: string;
  generatedAt: string;
  mallTitles: MallTitle[];
};
type GenerationStatus = "idle" | "running" | "ready" | "error";
type ShoplingStatus =
  | "idle"
  | "submitting"
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "already_registered";
type BatchRow = HandoffItem & {
  item: UnknownRecord | null;
  generationStatus: GenerationStatus;
  generationMessage: string;
  generationError: string;
  collectionMode: string;
  candidateCount: number;
  finalMaterialCount: number;
  warnings: string[];
  seoFinal: SeoFinal | null;
  shoplingStatus: ShoplingStatus;
  shoplingMessage: string;
  shoplingError: string;
  jobId: string;
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
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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
    throw new Error(
      text(body.message) || text(body.error) || `요청 실패 · HTTP ${response.status}`,
    );
  }
  return body;
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

function readBatchContext(): BatchContext | null {
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BatchContext;
    if (!parsed?.batchId || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeSeoFinal(value: unknown): SeoFinal | null {
  const source = record(value);
  const searchKeywords = stringList(source.searchKeywords);
  const groupProductNames = record(source.groupProductNames);
  if (!searchKeywords.length || !Object.keys(groupProductNames).length) return null;
  return {
    productName: text(source.productName),
    groupProductNames: Object.fromEntries(
      Object.entries(groupProductNames).map(([key, title]) => [key, text(title)]),
    ),
    searchKeywords,
    searchLine: text(source.searchLine) || searchKeywords.join(","),
    source: text(source.source),
    sourceUrl: text(source.sourceUrl),
    offerId: text(source.offerId),
    generatedAt: text(source.generatedAt),
    mallTitles: Array.isArray(source.mallTitles)
      ? source.mallTitles.map((value) => {
          const row = record(value);
          return {
            productGroup: text(row.productGroup),
            marketName: text(row.marketName),
            mallKey: text(row.mallKey),
            accountIdLabel: text(row.accountIdLabel),
            title: text(row.title),
          };
        })
      : [],
  };
}

function itemGoodsKeys(item: UnknownRecord | null) {
  const products = record(item?.shoplingProducts);
  return Object.values(products)
    .map((value) => text(record(value).goodsKey))
    .filter(Boolean);
}

function optionTextFromItem(item: UnknownRecord | null) {
  const options = Array.isArray(item?.orderOptions) ? item.orderOptions : [];
  return options
    .map((value) => {
      const row = record(value);
      return [
        text(row.saleOption),
        text(row.chinaOption),
        text(row.optionName),
        text(row.barcode),
      ]
        .filter(Boolean)
        .join(" / ");
    })
    .filter(Boolean)
    .join("\n");
}

function statusClass(status: GenerationStatus | ShoplingStatus) {
  if (status === "ready" || status === "success") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "error" || status === "failed") {
    return "bg-rose-100 text-rose-800";
  }
  if (
    status === "running" ||
    status === "submitting" ||
    status === "queued"
  ) {
    return "bg-amber-100 text-amber-900";
  }
  if (status === "already_registered") {
    return "bg-indigo-100 text-indigo-800";
  }
  return "bg-slate-100 text-slate-600";
}

function generationLabel(status: GenerationStatus) {
  return {
    idle: "대기",
    running: "FINAL 생성 중",
    ready: "FINAL 완료",
    error: "생성 오류",
  }[status];
}

function shoplingLabel(status: ShoplingStatus) {
  return {
    idle: "등록 대기",
    submitting: "등록 요청 중",
    queued: "실행 대기",
    running: "Shopling 등록 중",
    success: "등록 완료",
    failed: "등록 실패",
    already_registered: "기등록",
  }[status];
}

export default function SeoBulkCloudClient() {
  const [batch, setBatch] = useState<BatchContext | null>(null);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [globalError, setGlobalError] = useState("");
  const autoStartedRef = useRef(false);

  const updateRow = useCallback((itemId: string, patch: Partial<BatchRow>) => {
    setRows((current) =>
      current.map((row) => (row.id === itemId ? { ...row, ...patch } : row)),
    );
  }, []);

  const reloadItem = useCallback(async (itemId: string) => {
    const query = new URLSearchParams({ mode: "item", id: itemId });
    const response = await requestJson<{ ok?: boolean; item?: unknown; message?: unknown }>(
      `${NORMALIZED_API}?${query.toString()}`,
    );
    return record(response.item);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const context = readBatchContext();
    const requestedBatchId = new URLSearchParams(window.location.search).get("batchId");
    if (!context || (requestedBatchId && requestedBatchId !== context.batchId)) {
      setLoading(false);
      setGlobalError(
        "대량 실행할 상품 묶음을 찾지 못했습니다. 상품출시 진행관리에서 상품을 선택한 뒤 다시 열어 주세요.",
      );
      return;
    }
    setBatch(context);
    void mapLimit(context.items, 8, async (handoff) => {
      try {
        const item = await reloadItem(handoff.id);
        if (cancelled) return;
        const existing = normalizeSeoFinal(item.seoFinal);
        const goodsKeys = itemGoodsKeys(item);
        setRows((current) => [
          ...current,
          {
            ...handoff,
            item,
            generationStatus: existing ? "ready" : "idle",
            generationMessage: existing ? "저장된 FINAL RESULT를 불러왔습니다." : "생성 대기",
            generationError: "",
            collectionMode: "",
            candidateCount: 0,
            finalMaterialCount: 0,
            warnings: [],
            seoFinal: existing,
            shoplingStatus: goodsKeys.length ? "already_registered" : "idle",
            shoplingMessage: goodsKeys.length ? `goods_key ${goodsKeys.length}개 등록됨` : "",
            shoplingError: "",
            jobId: "",
          },
        ]);
      } catch (error) {
        if (cancelled) return;
        setRows((current) => [
          ...current,
          {
            ...handoff,
            item: null,
            generationStatus: "error",
            generationMessage: "",
            generationError:
              error instanceof Error ? error.message : "상품을 불러오지 못했습니다.",
            collectionMode: "",
            candidateCount: 0,
            finalMaterialCount: 0,
            warnings: [],
            seoFinal: null,
            shoplingStatus: "idle",
            shoplingMessage: "",
            shoplingError: "",
            jobId: "",
          },
        ]);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadItem]);

  const generateRows = useCallback(
    async (targets: BatchRow[]) => {
      if (!targets.length) return;
      setGenerating(true);
      setGlobalError("");
      setGlobalMessage(
        `${targets.length}개 상품 FINAL RESULT를 최대 ${GENERATION_CONCURRENCY}개씩 병렬 생성합니다.`,
      );
      const customBlockedTerms = readCustomBlockedTerms();
      await mapLimit(targets, GENERATION_CONCURRENCY, async (row) => {
        updateRow(row.id, {
          generationStatus: "running",
          generationMessage: "STEP 1~4 + 상품명/검색어 생성 중…",
          generationError: "",
        });
        try {
          const item = row.item ?? (await reloadItem(row.id));
          const resultBody = await requestJson<{
            ok?: boolean;
            result?: unknown;
            message?: unknown;
            error?: unknown;
          }>(KEYWORD_API, {
            method: "POST",
            body: JSON.stringify({
              action: "generate_bulk_final",
              item: {
                launchItemId: row.id,
                modelNumber: row.modelNumber,
                productName: row.productName,
                sourceUrl: row.sourceUrl,
                optionText: optionTextFromItem(item),
                supportingText: [
                  text(item.shoplingCategory),
                  text(item.productName),
                  text(item.modelNumber),
                ]
                  .filter(Boolean)
                  .join(" · "),
              },
              customBlockedTerms,
            }),
          });
          const result = record(resultBody.result);
          const seoFinal = normalizeSeoFinal(result.seoFinal);
          if (!seoFinal || seoFinal.searchKeywords.length !== 10) {
            throw new Error("FINAL RESULT 저장 전 검색어 10개 검증에 실패했습니다.");
          }
          await requestJson<{ ok?: boolean; message?: unknown }>(NORMALIZED_API, {
            method: "PATCH",
            body: JSON.stringify({
              operation: "patch_item",
              itemId: row.id,
              patch: { seoFinal },
              updatedBy: "SEO 대량등록 클라우드",
            }),
          });
          const refreshed = await reloadItem(row.id);
          updateRow(row.id, {
            item: refreshed,
            generationStatus: "ready",
            generationMessage: "FINAL RESULT 저장 완료",
            generationError: "",
            collectionMode: text(result.collectionMode),
            candidateCount: Number(result.candidateCount) || 0,
            finalMaterialCount: Number(result.finalMaterialCount) || 0,
            warnings: stringList(result.warnings),
            seoFinal,
          });
        } catch (error) {
          updateRow(row.id, {
            generationStatus: "error",
            generationMessage: "",
            generationError:
              error instanceof Error ? error.message : "FINAL RESULT 생성 실패",
          });
        }
      });
      setGenerating(false);
      setGlobalMessage("상품별 FINAL RESULT 생성 작업이 끝났습니다.");
    },
    [reloadItem, updateRow],
  );

  useEffect(() => {
    if (
      loading ||
      !batch?.autoStart ||
      autoStartedRef.current ||
      rows.length !== batch.items.length
    ) {
      return;
    }
    autoStartedRef.current = true;
    const targets = rows.filter(
      (row) => row.generationStatus !== "ready" && row.item && row.sourceUrl,
    );
    if (targets.length) void generateRows(targets);
  }, [batch, generateRows, loading, rows]);

  const pollShoplingJob = useCallback(
    async (row: BatchRow, jobId: string) => {
      for (let poll = 0; poll < 120; poll += 1) {
        await wait(poll === 0 ? 1500 : 5000);
        const query = new URLSearchParams({ jobId });
        const body = await requestJson<{ ok?: boolean; job?: unknown; message?: unknown }>(
          `${SHOPLING_UPLOAD_API}?${query.toString()}`,
        );
        const job = record(body.job);
        const status = text(job.status);
        if (status === "queued") {
          updateRow(row.id, {
            shoplingStatus: "queued",
            shoplingMessage: "GitHub Actions 실행 대기 중",
          });
          continue;
        }
        if (status === "running") {
          updateRow(row.id, {
            shoplingStatus: "running",
            shoplingMessage: "Shopling 6채널 등록 중",
          });
          continue;
        }
        if (status === "success") {
          const refreshed = await reloadItem(row.id);
          const goodsKeys = itemGoodsKeys(refreshed);
          updateRow(row.id, {
            item: refreshed,
            shoplingStatus: "success",
            shoplingMessage: `등록 완료 · goods_key ${goodsKeys.length}/6`,
            shoplingError: "",
          });
          return;
        }
        if (status === "failed" || status === "partial_failure") {
          throw new Error(text(job.error_message) || `Shopling 등록 ${status}`);
        }
      }
      throw new Error("Shopling 등록 결과 대기 시간이 초과되었습니다.");
    },
    [reloadItem, updateRow],
  );

  const registerRows = useCallback(
    async (targets: BatchRow[]) => {
      if (!targets.length) return;
      setRegistering(true);
      setGlobalError("");
      setGlobalMessage(
        `${targets.length}개 상품을 Shopling에 최대 ${REGISTRATION_CONCURRENCY}개씩 병렬 등록합니다.`,
      );
      await mapLimit(targets, REGISTRATION_CONCURRENCY, async (row) => {
        updateRow(row.id, {
          shoplingStatus: "submitting",
          shoplingMessage: "6채널 등록 작업 생성 중",
          shoplingError: "",
        });
        try {
          const body = await requestJson<{
            ok?: boolean;
            jobId?: unknown;
            requestId?: unknown;
            message?: unknown;
          }>(SHOPLING_UPLOAD_API, {
            method: "POST",
            body: JSON.stringify({ itemId: row.id }),
          });
          const jobId = text(body.jobId);
          if (!jobId) throw new Error("Shopling 작업 ID를 받지 못했습니다.");
          updateRow(row.id, {
            jobId,
            shoplingStatus: "queued",
            shoplingMessage: "등록 작업 제출 완료",
          });
          await pollShoplingJob(row, jobId);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Shopling 등록 실패";
          const already = /이미 등록|goods_key|중복 등록/.test(detail);
          updateRow(row.id, {
            shoplingStatus: already ? "already_registered" : "failed",
            shoplingMessage: already ? "기존 등록 상품" : "",
            shoplingError: detail,
          });
        }
      });
      setRegistering(false);
      setGlobalMessage("Shopling 일괄 대량등록 작업이 끝났습니다.");
    },
    [pollShoplingJob, updateRow],
  );

  const readyRows = useMemo(
    () => rows.filter((row) => row.generationStatus === "ready" && row.seoFinal),
    [rows],
  );
  const registerableRows = useMemo(
    () =>
      readyRows.filter(
        (row) =>
          !itemGoodsKeys(row.item).length &&
          !["submitting", "queued", "running", "success"].includes(
            row.shoplingStatus,
          ),
      ),
    [readyRows],
  );
  const completedRegistrations = rows.filter(
    (row) => row.shoplingStatus === "success" || row.shoplingStatus === "already_registered",
  ).length;

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 px-5 py-7 text-slate-900">
      <header className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-cyan-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">
              COMMERCE OS · PARALLEL SEO BULK CLOUD
            </p>
            <h1 className="mt-2 text-3xl font-black">SEO 대량등록 클라우드</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              상품출시 진행관리에서 여러 상품을 선택하면 동시에 FINAL RESULT를 생성하고,
              확정된 상품들을 한 번에 Shopling에 등록합니다. 기본 화면에는 최종 검색어와
              실행상태만 남기고 세부 근거는 접어두었습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/product-launch-tracker"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black"
            >
              상품출시 진행관리
            </Link>
            <button
              type="button"
              disabled={generating || loading || !rows.length}
              onClick={() => void generateRows(rows.filter((row) => row.item && row.sourceUrl))}
              className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
            >
              {generating ? "FINAL RESULT 생성 중…" : `FINAL RESULT 일괄 생성 (${rows.length})`}
            </button>
            <button
              type="button"
              disabled={registering || generating || !registerableRows.length}
              onClick={() => void registerRows(registerableRows)}
              className="rounded-xl bg-emerald-700 px-5 py-2 text-sm font-black text-white disabled:opacity-40"
            >
              {registering
                ? "Shopling 일괄등록 중…"
                : `Shopling 일괄 대량등록 (${registerableRows.length})`}
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-full bg-white px-3 py-1 ring-1 ring-violet-200">
            선택 {rows.length}개
          </span>
          <span className="rounded-full bg-cyan-100 px-3 py-1 text-cyan-900">
            FINAL {readyRows.length}/{rows.length}
          </span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
            Shopling 완료 {completedRegistrations}/{rows.length}
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
            SEO 병렬 {GENERATION_CONCURRENCY} · 등록 병렬 {REGISTRATION_CONCURRENCY}
          </span>
        </div>
        {globalMessage ? (
          <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-bold text-cyan-950">
            {globalMessage}
          </div>
        ) : null}
        {globalError ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
            {globalError}
          </div>
        ) : null}
      </header>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center font-bold text-slate-500">
          선택 상품을 불러오는 중…
        </div>
      ) : null}

      <section className="space-y-3">
        {rows.map((row, index) => (
          <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black text-slate-400">#{index + 1}</span>
                  <span className="font-black text-slate-950">{row.modelNumber || "모델번호 없음"}</span>
                  <span className="text-sm font-semibold text-slate-600">{row.productName}</span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${statusClass(row.generationStatus)}`}>
                    {generationLabel(row.generationStatus)}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${statusClass(row.shoplingStatus)}`}>
                    {shoplingLabel(row.shoplingStatus)}
                  </span>
                </div>
                {row.generationMessage ? (
                  <p className="mt-2 text-xs font-semibold text-slate-500">{row.generationMessage}</p>
                ) : null}
                {row.generationError ? (
                  <p className="mt-2 text-sm font-bold text-rose-700">{row.generationError}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] font-black">
                {row.collectionMode ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                    {row.collectionMode === "1688_server" ? "1688 수집" : "상품정보 fallback"}
                  </span>
                ) : null}
                {row.candidateCount ? (
                  <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">
                    후보 {row.candidateCount}
                  </span>
                ) : null}
                {row.finalMaterialCount ? (
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-700">
                    최종재료 {row.finalMaterialCount}
                  </span>
                ) : null}
              </div>
            </div>

            {row.seoFinal ? (
              <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                <div className="text-xs font-black uppercase tracking-[0.12em] text-cyan-700">
                  FINAL RESULT · 검색어 10개
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {row.seoFinal.searchKeywords.map((keyword, keywordIndex) => (
                    <span
                      key={`${row.id}-${keyword}`}
                      className="rounded-full border border-cyan-200 bg-white px-3 py-1.5 text-sm font-black text-cyan-950"
                    >
                      <span className="mr-1 text-[10px] text-cyan-500">#{keywordIndex + 1}</span>
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {row.shoplingMessage ? (
              <div className="mt-3 text-xs font-bold text-emerald-700">{row.shoplingMessage}</div>
            ) : null}
            {row.shoplingError ? (
              <div className="mt-3 text-xs font-bold text-rose-700">{row.shoplingError}</div>
            ) : null}

            <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">
                상품명·쇼핑몰 29개·세부 실행정보 펼치기
              </summary>
              <div className="border-t border-slate-200 p-4 text-sm">
                {row.seoFinal ? (
                  <>
                    <div className="font-black">SEO 모델명</div>
                    <div className="mt-1 text-slate-700">{row.seoFinal.productName}</div>
                    <div className="mt-4 font-black">6개 기준 상품명</div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {GROUPS.map(([key, label]) => (
                        <div key={key} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                          <div className="text-[10px] font-black text-slate-400">{label}</div>
                          <div className="mt-1 font-bold">{row.seoFinal?.groupProductNames[key]}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 font-black">쇼핑몰별 상품명 {row.seoFinal.mallTitles.length}/29</div>
                    <div className="mt-2 max-h-72 overflow-auto rounded-lg bg-white ring-1 ring-slate-200">
                      {row.seoFinal.mallTitles.map((mall) => (
                        <div key={`${mall.mallKey}-${mall.productGroup}`} className="grid gap-1 border-b border-slate-100 px-3 py-2 last:border-b-0 md:grid-cols-[150px_1fr]">
                          <span className="text-xs font-bold text-slate-500">{mall.productGroup} · {mall.marketName}</span>
                          <span className="font-semibold text-slate-800">{mall.title}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-slate-500">FINAL RESULT가 아직 없습니다.</div>
                )}
                <div className="mt-4 break-all text-xs text-slate-400">{row.sourceUrl}</div>
              </div>
            </details>
          </article>
        ))}
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-5 py-4 font-black text-slate-700">
          STEP 1~5 · 원장 · 진단 · 기존 세부 엔진 펼치기
        </summary>
        <div className="border-t border-slate-200 p-5">
          <p className="text-sm leading-6 text-slate-600">
            평소에는 위 FINAL RESULT와 일괄등록만 사용하면 됩니다. 상품 정체성·시장어·점수표·금지키워드·원장 재고를 직접 검토해야 할 때만 기존 세부 엔진을 엽니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/keyword-engine-elon-lab" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">
              기존 STEP 1~5 세부 엔진
            </Link>
            <Link href="/seo-title-cloud-shopling-runner" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">
              단건 Shopling 실행기
            </Link>
          </div>
        </div>
      </details>
    </main>
  );
}
