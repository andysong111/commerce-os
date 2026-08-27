"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  KEYWORD_ELON_V2_DEFAULT_CUTOFF,
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
  type KeywordElonTitleResult,
} from "@/lib/keywordEngineElonLabV2";
import {
  mergeKeywordElonCandidates,
  mergeKeywordElonDiscovery,
} from "@/lib/keywordEngineElonLabV2Merge";
import {
  normalizeKeywordElonSelectionThresholds,
  selectKeywordElonStep4Union,
} from "@/lib/keywordEngineElonLabV2Selection";

const BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const CUSTOM_BLOCKED_STORAGE_KEY = "keywordEngineElonLab.step4.customBlockedTerms.v1";
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
type SeoFinal = {
  productName: string;
  groupProductNames: Record<string, string>;
  searchKeywords: string[];
  searchLine: string;
  source: string;
  sourceUrl: string;
  offerId: string;
  generatedAt: string;
  mallTitles: Array<{
    productGroup: string;
    marketName: string;
    mallKey: string;
    accountIdLabel: string;
    title: string;
  }>;
};
type GenerationStatus = "idle" | "running" | "ready" | "error";
type ShoplingStatus = "idle" | "submitting" | "queued" | "running" | "success" | "failed";
type RunItem = {
  id: string;
  runId: string;
  runCreatedAt: string;
  trackerRowNumber: number;
  modelNumber: string;
  productName: string;
  sourceUrl: string;
  generationStatus?: GenerationStatus;
  shoplingStatus?: ShoplingStatus;
  seoFinal?: SeoFinal | null;
  generationError?: string;
  shoplingError?: string;
  jobId?: string;
  registeredGoodsKeys?: string[];
};
type BatchContext = {
  version: number;
  batchId: string;
  createdAt: string;
  updatedAt?: string;
  revision?: string;
  autoStart?: boolean;
  items: RunItem[];
};
type RunRow = RunItem & {
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
type Step4FilterResult = {
  allowedCount: number;
  removedCount: number;
  allowedKeys: string[];
  removedKeys: string[];
  decisions: unknown[];
  warnings?: string[];
};
type ExpansionResponse = UnknownRecord & {
  ok?: boolean;
  discovery?: KeywordElonDiscovery;
  seedKeywords?: string[];
  round?: number;
  newCandidateCount?: number;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function readableError(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => readableError(entry, depth + 1)).filter(Boolean).join(" · ").slice(0, 700);
  }
  if (typeof value === "object") {
    const row = value as UnknownRecord;
    for (const key of ["message", "error", "details", "reason", "code", "digest"]) {
      const message = readableError(row[key], depth + 1);
      if (message) return message;
    }
    try {
      return JSON.stringify(value).slice(0, 700);
    } catch {
      return "서버 오류";
    }
  }
  return "";
}

function requireObject<T>(value: unknown, label: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 응답 형식이 올바르지 않습니다.`);
  }
  return value as T;
}

function requireCandidates(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} 후보 응답이 없습니다.`);
  return value as KeywordElonCandidate[];
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
  const raw = await response.text();
  let parsed: unknown = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`서버가 JSON이 아닌 응답을 반환했습니다. HTTP ${response.status}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`서버 응답 형식이 올바르지 않습니다. HTTP ${response.status}`);
  }
  const body = parsed as T;
  if (!response.ok || body.ok !== true) {
    const stage = text(body.errorStage);
    const detail = readableError(body.message) || readableError(body.error) || `HTTP ${response.status}`;
    throw new Error(stage ? `[${stage}] ${detail}` : detail);
  }
  return body;
}

async function mapLimit<T>(values: T[], limit: number, worker: (value: T, index: number) => Promise<void>) {
  let cursor = 0;
  async function runner() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => runner()));
}

function newId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function normalizeSeoFinal(value: unknown): SeoFinal | null {
  const source = record(value);
  const searchKeywords = stringList(source.searchKeywords);
  const groupProductNames = record(source.groupProductNames);
  const mallTitles = array(source.mallTitles)
    .map(record)
    .map((row) => ({
      productGroup: text(row.productGroup),
      marketName: text(row.marketName),
      mallKey: text(row.mallKey),
      accountIdLabel: text(row.accountIdLabel),
      title: text(row.title),
    }))
    .filter((row) => row.title);
  if (searchKeywords.length !== 10 || mallTitles.length !== 29) return null;
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
    mallTitles,
  };
}

function normalizeRunItem(value: unknown, index: number): RunItem | null {
  const row = record(value);
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    runId: text(row.runId) || `legacy-${id}-${index}`,
    runCreatedAt: text(row.runCreatedAt) || text(row.createdAt) || new Date().toISOString(),
    trackerRowNumber: Number(row.trackerRowNumber) || 0,
    modelNumber: text(row.modelNumber),
    productName: text(row.productName),
    sourceUrl: text(row.sourceUrl),
    generationStatus: ["idle", "running", "ready", "error"].includes(text(row.generationStatus))
      ? (text(row.generationStatus) as GenerationStatus)
      : undefined,
    shoplingStatus: ["idle", "submitting", "queued", "running", "success", "failed"].includes(text(row.shoplingStatus))
      ? (text(row.shoplingStatus) as ShoplingStatus)
      : undefined,
    seoFinal: normalizeSeoFinal(row.seoFinal),
    generationError: text(row.generationError),
    shoplingError: text(row.shoplingError),
    jobId: text(row.jobId),
    registeredGoodsKeys: stringList(row.registeredGoodsKeys),
  };
}

function readBatchContext(): BatchContext | null {
  try {
    const raw = window.localStorage.getItem(BATCH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) return null;
    const items = parsed.items
      .map((item: unknown, index: number) => normalizeRunItem(item, index))
      .filter(Boolean) as RunItem[];
    return {
      version: Number(parsed.version) || 3,
      batchId: text(parsed.batchId) || newId("seo-bulk"),
      createdAt: text(parsed.createdAt) || new Date().toISOString(),
      updatedAt: text(parsed.updatedAt),
      revision: text(parsed.revision),
      autoStart: parsed.autoStart !== false,
      items,
    };
  } catch {
    return null;
  }
}

function writeBatch(context: BatchContext) {
  window.localStorage.setItem(
    BATCH_STORAGE_KEY,
    JSON.stringify({ ...context, updatedAt: new Date().toISOString() }),
  );
}

function patchStoredRun(runId: string, patch: UnknownRecord) {
  const current = readBatchContext();
  if (!current) return;
  writeBatch({
    ...current,
    items: current.items.map((item) =>
      item.runId === runId ? ({ ...item, ...patch } as RunItem) : item,
    ),
  });
}

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function itemGoodsKeys(item: UnknownRecord | null) {
  return Object.values(record(item?.shoplingProducts))
    .map((value) => text(record(value).goodsKey))
    .filter(Boolean);
}

function optionTextFromItem(item: UnknownRecord | null) {
  return array(item?.orderOptions)
    .map(record)
    .map((row) => [text(row.saleOption), text(row.chinaOption), text(row.optionName), text(row.barcode)].filter(Boolean).join(" / "))
    .filter(Boolean)
    .join("\n");
}

function mallTitlesFromFinal(value: unknown) {
  return array(record(value).mallTitles).map(record).map((row) => text(row.title)).filter(Boolean);
}

function historicalMallTitles(item: UnknownRecord | null) {
  const titles = [...mallTitlesFromFinal(item?.seoFinal)];
  for (const entryValue of array(item?.shoplingRegistrationHistory)) {
    const entry = record(entryValue);
    for (const key of ["previousSeoFinal", "seoFinal", "registeredSeoFinal", "newSeoFinal"]) {
      titles.push(...mallTitlesFromFinal(entry[key]));
    }
  }
  return [...new Set(titles)].slice(0, 1200);
}

function seedRows(candidates: KeywordElonCandidate[]) {
  return uniqueKeywordElonCanonical(
    candidates
      .filter((row) => row.safetyPass && row.qualityScore >= KEYWORD_ELON_V2_DEFAULT_CUTOFF)
      .sort((a, b) => b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1))
      .map((row) => row.searchKeyword || row.searchKey || row.keyword),
    8,
  );
}

function blockedKeysFromFilter(result: Step4FilterResult) {
  return (Array.isArray(result.decisions) ? result.decisions : [])
    .map(record)
    .filter((row) => row.blocked === true)
    .map((row) => text(row.searchKey) || text(row.keyword))
    .filter(Boolean);
}

function groupByItem(rows: RunRow[]) {
  const groups = new Map<string, RunRow[]>();
  for (const row of rows) {
    const current = groups.get(row.id) ?? [];
    current.push(row);
    groups.set(row.id, current);
  }
  return [...groups.values()].map((group) =>
    [...group].sort((a, b) => a.runCreatedAt.localeCompare(b.runCreatedAt)),
  );
}

function nextSelfCode() {
  return `PLR${newId("").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10)}`.slice(0, 54);
}

function statusClass(status: GenerationStatus | ShoplingStatus) {
  if (status === "ready" || status === "success") return "bg-emerald-100 text-emerald-800";
  if (status === "error" || status === "failed") return "bg-rose-100 text-rose-800";
  if (["running", "submitting", "queued"].includes(status)) return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-600";
}

function generationLabel(status: GenerationStatus) {
  return { idle: "생성 대기", running: "FINAL 생성 중", ready: "FINAL 완료", error: "생성 오류" }[status];
}

function shoplingLabel(status: ShoplingStatus) {
  return { idle: "등록 대기", submitting: "등록 요청 중", queued: "실행 대기", running: "Shopling 등록 중", success: "등록 완료", failed: "등록 실패" }[status];
}

export default function SeoBulkRunCloudClient() {
  const [batch, setBatch] = useState<BatchContext | null>(null);
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [globalError, setGlobalError] = useState("");
  const rowsRef = useRef<RunRow[]>([]);
  const autoStartedRunsRef = useRef(new Set<string>());

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const updateRun = useCallback((runId: string, patch: Partial<RunRow>, persist = false) => {
    setRows((current) => current.map((row) => (row.runId === runId ? { ...row, ...patch } : row)));
    if (persist) patchStoredRun(runId, patch as UnknownRecord);
  }, []);

  const reloadItem = useCallback(async (itemId: string) => {
    const query = new URLSearchParams({ mode: "item", id: itemId });
    const body = await requestJson<{ ok?: boolean; item?: unknown }>(`${NORMALIZED_API}?${query.toString()}`);
    return record(body.item);
  }, []);

  const patchItem = useCallback(async (itemId: string, patch: UnknownRecord, updatedBy: string) => {
    await requestJson<{ ok?: boolean }>(NORMALIZED_API, {
      method: "PATCH",
      body: JSON.stringify({ operation: "patch_item", itemId, patch, updatedBy }),
    });
  }, []);

  const syncFromStorage = useCallback(async () => {
    const context = readBatchContext();
    if (!context) {
      setBatch(null);
      setRows([]);
      setLoading(false);
      return;
    }
    setBatch(context);
    const existing = new Map(rowsRef.current.map((row) => [row.runId, row]));
    const nextRows: RunRow[] = [];
    await mapLimit(context.items, 8, async (run) => {
      const current = existing.get(run.runId);
      let item = current?.item ?? null;
      if (!item) {
        try {
          item = await reloadItem(run.id);
        } catch {
          item = null;
        }
      }
      const persistedFinal = normalizeSeoFinal(run.seoFinal);
      nextRows.push({
        ...run,
        item,
        generationStatus: current?.generationStatus ?? run.generationStatus ?? (persistedFinal ? "ready" : "idle"),
        generationMessage: current?.generationMessage ?? (persistedFinal ? "이 등록회차의 저장된 FINAL RESULT를 불러왔습니다." : "새 등록회차 · 생성 대기"),
        generationError: current?.generationError ?? run.generationError ?? "",
        collectionMode: current?.collectionMode ?? "",
        candidateCount: current?.candidateCount ?? 0,
        finalMaterialCount: current?.finalMaterialCount ?? 0,
        warnings: current?.warnings ?? [],
        seoFinal: current?.seoFinal ?? persistedFinal,
        shoplingStatus: current?.shoplingStatus ?? run.shoplingStatus ?? "idle",
        shoplingMessage: current?.shoplingMessage ?? (run.shoplingStatus === "success" ? "이 등록회차 완료" : ""),
        shoplingError: current?.shoplingError ?? run.shoplingError ?? "",
        jobId: current?.jobId ?? run.jobId ?? "",
      });
    });
    const order = new Map(context.items.map((item, index) => [item.runId, index]));
    nextRows.sort((a, b) => (order.get(a.runId) ?? 0) - (order.get(b.runId) ?? 0));
    setRows(nextRows);
    setLoading(false);
  }, [reloadItem]);

  useEffect(() => {
    void syncFromStorage();
    const onStorage = (event: StorageEvent) => {
      if (event.key === BATCH_STORAGE_KEY) void syncFromStorage();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [syncFromStorage]);

  const generateOne = useCallback(async (row: RunRow, inheritedExclusions: string[]) => {
    updateRun(row.runId, { generationStatus: "running", generationMessage: "원본 준비 중…", generationError: "" });
    const customBlockedTerms = readCustomBlockedTerms();
    try {
      const item = row.item ?? (await reloadItem(row.id));
      const exclusions = [...new Set([...historicalMallTitles(item), ...inheritedExclusions])].slice(0, 1200);
      const itemInput = {
        launchItemId: row.id,
        modelNumber: row.modelNumber,
        productName: row.productName,
        sourceUrl: row.sourceUrl,
        optionText: optionTextFromItem(item),
        supportingText: [text(item.shoplingCategory), text(item.productName), text(item.modelNumber)].filter(Boolean).join(" · "),
        mallTitleCategory: text(item.shoplingCategory),
        variationSeed: row.runId,
        excludedMallTitles: exclusions,
      };

      updateRun(row.runId, { generationMessage: "원본 준비 · 1688 수집/상품정보 fallback 확인 중…" });
      const collected = await requestJson<{ ok?: boolean; source?: unknown; collectionMode?: unknown }>(KEYWORD_API, {
        method: "POST",
        body: JSON.stringify({ action: "collect_bulk_source", item: itemInput, customBlockedTerms }),
      });
      const source = requireObject<KeywordElonSourceDraft>(collected.source, "원본 수집");
      const collectionMode = text(collected.collectionMode) === "1688_server" ? "1688_server" : "tracker_fallback";

      updateRun(row.runId, { collectionMode, generationMessage: "STEP 1 · 상품 정체성 분석 중…" });
      const identityBody = await requestJson<{ ok?: boolean; identity?: unknown }>(KEYWORD_API, {
        method: "POST",
        body: JSON.stringify({ action: "analyze_identity", source }),
      });
      const identity = requireObject<KeywordElonIdentity>(identityBody.identity, "STEP 1 정체성");

      updateRun(row.runId, { generationMessage: "STEP 2 · 시장어 후보 발굴 중…" });
      const discoveryBody = await requestJson<{ ok?: boolean; discovery?: unknown }>(KEYWORD_API, {
        method: "POST",
        body: JSON.stringify({ action: "discover_keywords", source, identity }),
      });
      let discovery = requireObject<KeywordElonDiscovery>(discoveryBody.discovery, "STEP 2 시장어 발굴");

      updateRun(row.runId, { generationMessage: `STEP 2 · 후보 ${discovery.candidates.length}개 점수화 중…` });
      const scoredBody = await requestJson<{ ok?: boolean; candidates?: unknown }>(KEYWORD_API, {
        method: "POST",
        body: JSON.stringify({ action: "score_keywords", source, identity, discovery, shoplingCategory: text(item.shoplingCategory) }),
      });
      let candidates = requireCandidates(scoredBody.candidates, "STEP 2 점수화");
      updateRun(row.runId, { candidateCount: candidates.length });

      for (let round = 1; round <= 3; round += 1) {
        const seeds = seedRows(candidates);
        if (!seeds.length) break;
        updateRun(row.runId, { generationMessage: `STEP 3 · round ${round}/3 확장 중…` });
        const expanded = await requestJson<ExpansionResponse>(KEYWORD_API, {
          method: "POST",
          body: JSON.stringify({ action: "expand_from_passing", identity, seedKeywords: seeds, existingDiscovery: discovery, existingCandidates: candidates, round }),
        });
        const expandedDiscovery = requireObject<KeywordElonDiscovery>(expanded.discovery, `STEP 3 round ${round} 확장`);
        if (!Number(expanded.newCandidateCount) || !expandedDiscovery.candidates.length) continue;
        const roundScored = await requestJson<{ ok?: boolean; candidates?: unknown }>(KEYWORD_API, {
          method: "POST",
          body: JSON.stringify({ action: "score_keywords", source, identity, discovery: expandedDiscovery, shoplingCategory: text(item.shoplingCategory) }),
        });
        candidates = mergeKeywordElonCandidates(candidates, requireCandidates(roundScored.candidates, `STEP 3 round ${round} 점수화`));
        discovery = mergeKeywordElonDiscovery(discovery, expandedDiscovery);
        updateRun(row.runId, { candidateCount: candidates.length });
      }

      const finalCandidates = selectKeywordElonStep4Union(candidates, normalizeKeywordElonSelectionThresholds());
      if (!finalCandidates.length) throw new Error("STEP 4에 전달할 월검색량/정확성 통과 후보가 없습니다.");
      updateRun(row.runId, { generationMessage: `STEP 4 · 금지키워드 검사 중 (${finalCandidates.length}개)…` });
      const filterBody = await requestJson<{ ok?: boolean; result?: unknown }>(KEYWORD_API, {
        method: "POST",
        body: JSON.stringify({ action: "filter_prohibited_keywords", identity, candidates: finalCandidates, customBlockedTerms }),
      });
      const filterResult = requireObject<Step4FilterResult>(filterBody.result, "STEP 4 금지키워드");
      const allowedSet = new Set(stringList(filterResult.allowedKeys));
      const allowedCandidates = finalCandidates.filter((candidate) =>
        allowedSet.has(compactKeywordElonKey(candidate.searchKeyword || candidate.searchKey || candidate.keyword)),
      );
      if (!allowedCandidates.length) throw new Error("금지키워드 제거 후 사용할 SEO 재료가 없습니다.");
      const finalMaterialCount = Math.max(0, Math.floor(Number(filterResult.allowedCount) || 0)) || allowedCandidates.length;

      updateRun(row.runId, { finalMaterialCount, generationMessage: "FINAL · 상품명 생성 중…" });
      const titleBody = await requestJson<{ ok?: boolean; titleResult?: unknown }>(KEYWORD_API, {
        method: "POST",
        body: JSON.stringify({ action: "generate_title", source, identity, candidates: allowedCandidates, cutoff: 0 }),
      });
      const titleResult = requireObject<KeywordElonTitleResult>(titleBody.titleResult, "FINAL 상품명");

      updateRun(row.runId, { generationMessage: "FINAL · 검색어 10개/쇼핑몰 29개 조립 중…" });
      const composed = await requestJson<{ ok?: boolean; result?: unknown }>(KEYWORD_API, {
        method: "POST",
        body: JSON.stringify({
          action: "compose_bulk_final",
          item: itemInput,
          source,
          collectionMode,
          identity,
          candidates,
          allowedKeys: stringList(filterResult.allowedKeys),
          blockedKeys: blockedKeysFromFilter(filterResult),
          finalMaterialCount,
          titleResult,
          customBlockedTerms,
          variationSeed: row.runId,
          excludedMallTitles: exclusions,
        }),
      });
      const result = record(composed.result);
      const seoFinal = normalizeSeoFinal(record(result).seoFinal);
      if (!seoFinal) throw new Error("FINAL RESULT 검증 실패 · 검색어 10개/쇼핑몰명 29개 조건을 만족하지 못했습니다.");
      const patch: Partial<RunRow> = {
        item,
        generationStatus: "ready",
        generationMessage: `새 등록회차 FINAL 완료 · 과거 상품명 ${exclusions.length}개와 비교`,
        generationError: "",
        collectionMode: text(result.collectionMode) || collectionMode,
        candidateCount: Number(result.candidateCount) || candidates.length,
        finalMaterialCount: Number(result.finalMaterialCount) || finalMaterialCount,
        warnings: [...stringList(result.warnings), ...stringList(filterResult.warnings)],
        seoFinal,
      };
      updateRun(row.runId, patch, true);
      return seoFinal.mallTitles.map((mall) => mall.title);
    } catch (error) {
      const generationError = error instanceof Error ? error.message : readableError(error) || "FINAL RESULT 생성 실패";
      updateRun(row.runId, { generationStatus: "error", generationMessage: "", generationError }, true);
      return [];
    }
  }, [reloadItem, updateRun]);

  const generateRows = useCallback(async (targets: RunRow[]) => {
    if (!targets.length) return;
    setGenerating(true);
    setGlobalError("");
    setGlobalMessage(`${targets.length}개 SEO 등록회차를 처리합니다. 같은 상품의 여러 회차는 상품명 중복 방지를 위해 순차 생성합니다.`);
    const groups = groupByItem(targets);
    await mapLimit(groups, GENERATION_CONCURRENCY, async (group) => {
      const inherited: string[] = [];
      for (const row of group) {
        const newTitles = await generateOne(row, inherited);
        inherited.push(...newTitles);
      }
    });
    setGenerating(false);
    setGlobalMessage("SEO 등록회차별 FINAL 생성이 끝났습니다.");
  }, [generateOne]);

  useEffect(() => {
    if (loading || !batch?.autoStart) return;
    const targets = rows.filter(
      (row) => row.generationStatus === "idle" && row.item && row.sourceUrl && !autoStartedRunsRef.current.has(row.runId),
    );
    if (!targets.length) return;
    targets.forEach((row) => autoStartedRunsRef.current.add(row.runId));
    void generateRows(targets);
  }, [batch, generateRows, loading, rows]);

  const pollShoplingJob = useCallback(async (row: RunRow, jobId: string) => {
    for (let poll = 0; poll < 120; poll += 1) {
      await wait(poll === 0 ? 1500 : 5000);
      const query = new URLSearchParams({ jobId });
      const body = await requestJson<{ ok?: boolean; job?: unknown }>(`${SHOPLING_UPLOAD_API}?${query.toString()}`);
      const job = record(body.job);
      const status = text(job.status);
      if (status === "queued") {
        updateRun(row.runId, { shoplingStatus: "queued", shoplingMessage: "GitHub Actions 실행 대기 중" });
        continue;
      }
      if (status === "running") {
        updateRun(row.runId, { shoplingStatus: "running", shoplingMessage: "Shopling 6채널 등록 중" });
        continue;
      }
      if (status === "success") return job;
      if (status === "failed" || status === "partial_failure") {
        throw new Error(text(job.error_message) || `Shopling 등록 ${status}`);
      }
    }
    throw new Error("Shopling 등록 결과 대기 시간이 초과되었습니다.");
  }, [updateRun]);

  const registerOne = useCallback(async (row: RunRow) => {
    if (!row.seoFinal) throw new Error(`${row.modelNumber}: 등록할 FINAL RESULT가 없습니다.`);
    updateRun(row.runId, { shoplingStatus: "submitting", shoplingMessage: "새 selfCode·이미지 회차 준비 중", shoplingError: "" });
    const original = await reloadItem(row.id);
    const previousProducts = record(original.shoplingProducts);
    const previousSeoFinal = original.seoFinal ?? null;
    const previousSelfCodeBase = text(original.selfCodeBase);
    const previousHistory = array(original.shoplingRegistrationHistory).map(record);
    const previousMallSeoApply = original.mallSeoApply ?? null;
    const previousPricePolicy = original.pricePolicy ?? null;
    const hasExistingGoods = itemGoodsKeys(original).length > 0;
    const newSelfCodeBase = nextSelfCode();
    const reservedAt = new Date().toISOString();
    const historyEntry = {
      registrationType: hasExistingGoods ? "seo_inventory_append" : "seo_run_initial",
      seoRunId: row.runId,
      status: "reserved",
      archivedAt: reservedAt,
      previousSelfCodeBase,
      previousProducts,
      previousSeoFinal,
      newSeoFinal: row.seoFinal,
    };

    try {
      await patchItem(
        row.id,
        {
          seoFinal: row.seoFinal,
          selfCodeBase: newSelfCodeBase,
          mallSeoApply: null,
          pricePolicy: null,
          shoplingRegistrationHistory: hasExistingGoods ? [...previousHistory, historyEntry] : previousHistory,
          seoRunDispatch: { status: "prepared", seoRunId: row.runId, preparedAt: reservedAt, newSelfCodeBase },
        },
        "SEO 실행회차 Shopling 등록 준비",
      );

      const started = await requestJson<{ ok?: boolean; jobId?: unknown; requestId?: unknown }>(SHOPLING_UPLOAD_API, {
        method: "POST",
        body: JSON.stringify({ itemId: row.id, force: hasExistingGoods }),
      });
      const jobId = text(started.jobId);
      const requestId = text(started.requestId);
      if (!jobId) throw new Error(`${row.modelNumber}: Shopling 작업 ID를 받지 못했습니다.`);
      updateRun(row.runId, { jobId, shoplingStatus: "queued", shoplingMessage: hasExistingGoods ? "기존 상품 유지 · 새 6채널 추가등록 대기" : "첫 6채널 등록 대기" }, true);
      const job = await pollShoplingJob(row, jobId);
      const refreshed = await reloadItem(row.id);
      const refreshedHistory = array(refreshed.shoplingRegistrationHistory).map(record);
      const successAt = new Date().toISOString();
      const goodsKeys = itemGoodsKeys(refreshed);
      const nextHistory = hasExistingGoods
        ? refreshedHistory.map((entry) =>
            text(entry.seoRunId) === row.runId
              ? { ...entry, status: "success", completedAt: successAt, jobId, requestId, newProducts: refreshed.shoplingProducts, registeredSeoFinal: row.seoFinal }
              : entry,
          )
        : [
            ...refreshedHistory,
            {
              ...historyEntry,
              status: "success",
              completedAt: successAt,
              jobId,
              requestId,
              newProducts: refreshed.shoplingProducts,
              registeredSeoFinal: row.seoFinal,
            },
          ];
      await patchItem(
        row.id,
        {
          shoplingRegistrationHistory: nextHistory,
          seoRunDispatch: { status: "success", seoRunId: row.runId, jobId, requestId, completedAt: successAt },
        },
        "SEO 실행회차 Shopling 등록 완료",
      );
      const patch: Partial<RunRow> = {
        item: refreshed,
        shoplingStatus: "success",
        shoplingMessage: `등록 완료 · 새 goods_key ${goodsKeys.length}/6 · 다음 등록은 다음 이미지 회차`,
        shoplingError: "",
        jobId,
        registeredGoodsKeys: goodsKeys,
      };
      updateRun(row.runId, patch, true);
      return job;
    } catch (error) {
      const detail = error instanceof Error ? error.message : readableError(error) || "Shopling 등록 실패";
      await patchItem(
        row.id,
        {
          shoplingProducts: previousProducts,
          seoFinal: previousSeoFinal,
          selfCodeBase: previousSelfCodeBase,
          mallSeoApply: previousMallSeoApply,
          pricePolicy: previousPricePolicy,
          shoplingRegistrationHistory: previousHistory,
          seoRunDispatch: { status: "failed", seoRunId: row.runId, failedAt: new Date().toISOString(), error: detail },
        },
        "SEO 실행회차 Shopling 등록 실패 복구",
      ).catch(() => null);
      updateRun(row.runId, { shoplingStatus: "failed", shoplingMessage: "", shoplingError: detail }, true);
      throw error;
    }
  }, [patchItem, pollShoplingJob, reloadItem, updateRun]);

  const registerRows = useCallback(async (targets: RunRow[]) => {
    if (!targets.length) return;
    setRegistering(true);
    setGlobalError("");
    setGlobalMessage(`${targets.length}개 등록회차를 Shopling에 등록합니다. 같은 상품의 여러 회차는 이미지·selfCode 충돌 방지를 위해 순차 등록합니다.`);
    const groups = groupByItem(targets);
    await mapLimit(groups, REGISTRATION_CONCURRENCY, async (group) => {
      for (const row of group) {
        try {
          await registerOne(row);
        } catch {
          // Per-run state already contains the failure. Continue other products/runs.
        }
      }
    });
    setRegistering(false);
    setGlobalMessage("Shopling 등록회차 실행이 끝났습니다. 완료 카드는 보관해도 상품 원본은 계속 재사용됩니다.");
  }, [registerOne]);

  const archiveRuns = useCallback((runIds: string[]) => {
    if (!runIds.length) return;
    const current = readBatchContext();
    if (!current) return;
    const remove = new Set(runIds);
    const next = { ...current, items: current.items.filter((item) => !remove.has(item.runId)) };
    writeBatch(next);
    setBatch(next);
    setRows((currentRows) => currentRows.filter((row) => !remove.has(row.runId)));
  }, []);

  const readyRows = useMemo(() => rows.filter((row) => row.generationStatus === "ready" && row.seoFinal), [rows]);
  const registerableRows = useMemo(
    () => readyRows.filter((row) => !["submitting", "queued", "running", "success"].includes(row.shoplingStatus)),
    [readyRows],
  );
  const retryRows = useMemo(() => rows.filter((row) => row.generationStatus === "error" && row.item && row.sourceUrl), [rows]);
  const completedRows = useMemo(() => rows.filter((row) => row.shoplingStatus === "success"), [rows]);

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 px-5 py-7 text-slate-900">
      <header className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-cyan-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">COMMERCE OS · SEO RUN INSTANCE CLOUD</p>
            <h1 className="mt-2 text-3xl font-black">SEO 대량등록 클라우드</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              상품은 원본으로 유지하고, 상품출시 진행관리에서 SEO 클라우드를 누를 때마다 독립 등록회차가 하나씩 추가됩니다.
              기존 goods_key가 있어도 새 상품명·새 selfCode·다음 이미지 회차로 추가등록합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/product-launch-tracker" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">상품출시 진행관리</Link>
            <button
              type="button"
              disabled={registering || generating || !registerableRows.length}
              onClick={() => void registerRows(registerableRows)}
              className="rounded-xl bg-emerald-700 px-5 py-2 text-sm font-black text-white disabled:opacity-40"
            >
              {registering ? "Shopling 일괄등록 중…" : `Shopling 일괄 대량등록 (${registerableRows.length})`}
            </button>
            <button
              type="button"
              disabled={!completedRows.length || registering}
              onClick={() => archiveRuns(completedRows.map((row) => row.runId))}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 disabled:opacity-40"
            >
              등록완료 카드 보관 ({completedRows.length})
            </button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-full bg-white px-3 py-1 ring-1 ring-violet-200">활성 등록회차 {rows.length}</span>
          <span className="rounded-full bg-cyan-100 px-3 py-1 text-cyan-900">FINAL {readyRows.length}/{rows.length}</span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">등록완료 {completedRows.length}/{rows.length}</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">상품별 회차 순차 · 상품간 병렬 {REGISTRATION_CONCURRENCY}</span>
        </div>
        {globalMessage ? <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-bold text-cyan-950">{globalMessage}</div> : null}
        {globalError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{globalError}</div> : null}
      </header>

      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center font-bold text-slate-500">등록회차를 불러오는 중…</div> : null}
      {!loading && !rows.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="font-black text-slate-700">현재 활성 SEO 등록회차가 없습니다.</div>
          <div className="mt-2 text-sm text-slate-500">상품출시 진행관리에서 원하는 상품을 선택하고 SEO 대량등록 클라우드 열기를 누르세요. 같은 상품도 누를 때마다 새 회차가 생성됩니다.</div>
        </div>
      ) : null}

      {retryRows.length ? (
        <button type="button" disabled={generating} onClick={() => void generateRows(retryRows)} className="rounded-xl bg-violet-700 px-5 py-2 text-sm font-black text-white disabled:opacity-40">
          생성 오류 회차 재실행 ({retryRows.length})
        </button>
      ) : null}

      <section className="space-y-3">
        {rows.map((row, index) => {
          const existingGoods = itemGoodsKeys(row.item).length;
          return (
            <article key={row.runId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-black text-slate-400">#{index + 1}</span>
                    <span className="font-black text-slate-950">{row.modelNumber || "모델번호 없음"}</span>
                    <span className="text-sm font-semibold text-slate-600">{row.productName}</span>
                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-black text-violet-800">RUN {row.runId.slice(-8)}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${statusClass(row.generationStatus)}`}>{generationLabel(row.generationStatus)}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${statusClass(row.shoplingStatus)}`}>{shoplingLabel(row.shoplingStatus)}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">{existingGoods ? `기존 ${existingGoods}채널 · 추가등록` : "첫 등록"}</span>
                  </div>
                  {row.generationMessage ? <p className="mt-2 text-xs font-semibold text-slate-500">{row.generationMessage}</p> : null}
                  {row.generationError ? <p className="mt-2 break-words text-sm font-bold text-rose-700">{row.generationError}</p> : null}
                  {row.shoplingMessage ? <p className="mt-2 text-xs font-bold text-emerald-700">{row.shoplingMessage}</p> : null}
                  {row.shoplingError ? <p className="mt-2 break-words text-xs font-bold text-rose-700">{row.shoplingError}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.generationStatus === "error" ? (
                    <button type="button" onClick={() => void generateRows([row])} disabled={generating} className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-black text-violet-800">이 회차 다시 생성</button>
                  ) : null}
                  {row.shoplingStatus === "success" ? (
                    <button type="button" onClick={() => archiveRuns([row.runId])} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700">완료 카드 보관</button>
                  ) : null}
                </div>
              </div>

              {row.seoFinal ? (
                <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                  <div className="text-xs font-black uppercase tracking-[0.12em] text-cyan-700">FINAL RESULT · 검색어 10개</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.seoFinal.searchKeywords.map((keyword, keywordIndex) => (
                      <span key={`${row.runId}-${keywordIndex}-${keyword}`} className="rounded-full border border-cyan-200 bg-white px-3 py-1.5 text-sm font-black text-cyan-950">
                        <span className="mr-1 text-[10px] text-cyan-500">#{keywordIndex + 1}</span>{keyword}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">상품명·쇼핑몰 29개·회차 정보 펼치기</summary>
                <div className="border-t border-slate-200 p-4 text-sm">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div><span className="font-black text-slate-600">회차 ID</span><div className="mt-1 break-all text-xs">{row.runId}</div></div>
                    <div><span className="font-black text-slate-600">생성시각</span><div className="mt-1 text-xs">{row.runCreatedAt}</div></div>
                  </div>
                  {row.seoFinal ? (
                    <>
                      <div className="mt-4 font-black text-slate-700">6개 기준 상품명</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {GROUPS.map(([key, label]) => (
                          <div key={key} className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="text-[10px] font-black uppercase text-slate-400">{label}</div>
                            <div className="mt-1 font-bold">{row.seoFinal?.groupProductNames[key] || "-"}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 font-black text-slate-700">쇼핑몰별 상품명 {row.seoFinal.mallTitles.length}/29</div>
                      <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white">
                        {row.seoFinal.mallTitles.map((mall, mallIndex) => (
                          <div key={`${row.runId}-${mallIndex}`} className="grid gap-1 border-b border-slate-100 px-3 py-2 last:border-b-0 md:grid-cols-[220px_1fr]">
                            <div className="text-xs font-bold text-slate-500">{mall.productGroup} · {mall.marketName}</div>
                            <div className="font-semibold">{mall.title}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </details>
            </article>
          );
        })}
      </section>
    </main>
  );
}
