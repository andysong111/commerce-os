"use client";

import { useEffect, useMemo, useState } from "react";
import { applyShoplingCategoryReviewDecisions } from "@/lib/shoplingCategoryReview";

const STATE_ENDPOINT = "/api/product-launch-tracker/state";
const AI_ENDPOINT = "/api/product-launch-tracker/ai-category";
const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";

type TrackerItem = Record<string, unknown> & {
  id?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  archivedAt?: unknown;
  orderOptions?: unknown;
  shoplingCategory?: unknown;
  chinaProductLinks?: unknown;
  categoryAiStatus?: unknown;
  categoryAiSuggestion?: unknown;
  categoryAiAlternatives?: unknown;
  categoryAiCandidateChoices?: unknown;
  categoryAiCandidatePaths?: unknown;
  categoryAiReason?: unknown;
  categoryAiConfidence?: unknown;
  categoryAiMarketEvidence?: unknown;
};

type TrackerState = Record<string, unknown> & { items: TrackerItem[] };

type ReviewItem = {
  itemId: string;
  modelNumber: string;
  productName: string;
  confidence: number;
  reason: string;
  candidates: string[];
  marketEvidence: MarketEvidence | null;
};

type MarketEvidence = {
  status: "web" | "model_fallback";
  confidence: number;
  summary: string;
  categoryPaths: string[];
  sourceDomains: string[];
};

type AiResult = {
  selectedPath?: unknown;
  confidence?: unknown;
  reason?: unknown;
  alternatives?: unknown;
  candidateChoices?: unknown;
  candidatePaths?: unknown;
  autoApply?: unknown;
  skippedExisting?: unknown;
  marketEvidence?: unknown;
};

export function ShoplingCategoryCoreNounReview() {
  const [state, setState] = useState<TrackerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void loadStateWithRetry();
  }, []);

  const reviews = useMemo(() => buildReviews(state), [state]);

  async function loadStateWithRetry() {
    setLoading(true);
    setLoadError("");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const next = await readServerState();
      if (next) {
        setState(next);
        setLoading(false);
        return;
      }
      if (attempt < 3) await delay(500 * attempt);
    }
    setLoadError("검토 데이터를 불러오지 못했습니다. 다시 불러오기를 눌러주세요.");
    setLoading(false);
  }

  async function approve(item: ReviewItem, category: string) {
    if (busyKey) return;
    setBusyKey(`approve:${item.itemId}`);
    setNotice("");
    try {
      const latest = await requireServerState();
      const result = applyShoplingCategoryReviewDecisions(
        latest,
        [{ itemId: item.itemId, action: "approve", category }],
        { reviewer: "AI 카테고리 검토함" },
      );
      await persistState(result.state as TrackerState);
      setNotice(`${item.modelNumber || item.productName} · 선택한 후보를 승인했습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "후보 승인에 실패했습니다.");
    } finally {
      setBusyKey("");
    }
  }

  async function reanalyze(item: ReviewItem) {
    if (busyKey) return;
    setBusyKey(`reanalyze:${item.itemId}`);
    setNotice("");
    try {
      const latest = await requireServerState();
      const source = latest.items.find(
        (candidate) => text(candidate?.id) === item.itemId,
      );
      if (!source) throw new Error("재분석할 상품을 찾지 못했습니다.");

      const response = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          items: [
            {
              itemId: source.id,
              modelNumber: source.modelNumber,
              productName: source.productName,
              optionLabels: Array.isArray(source.orderOptions)
                ? source.orderOptions
                    .map((option) =>
                      option && typeof option === "object"
                        ? text((option as { saleOption?: unknown }).saleOption)
                        : "",
                    )
                    .filter(Boolean)
                : [],
              currentCategory: text(source.shoplingCategory),
              chinaProductLinks: Array.isArray(source.chinaProductLinks)
                ? source.chinaProductLinks
                : [],
            },
          ],
        }),
      });
      const body = await response.json().catch(() => ({}));
      const ai = Array.isArray(body?.results) ? (body.results[0] as AiResult) : null;
      if (!response.ok || body?.ok !== true || !ai) {
        throw new Error(body?.message || "새 카테고리 후보를 생성하지 못했습니다.");
      }

      const now = new Date().toISOString();
      const selectedPath = text(ai.selectedPath);
      const autoApply = ai.autoApply === true && Boolean(selectedPath);
      const skippedExisting = ai.skippedExisting === true;
      const next: TrackerState = {
        ...latest,
        savedAt: now,
        items: latest.items.map((candidate) =>
          text(candidate?.id) === item.itemId
            ? {
                ...candidate,
                shoplingCategory: autoApply
                  ? selectedPath
                  : candidate.shoplingCategory,
                categoryAiSuggestion: selectedPath,
                categoryAiConfidence: Math.max(
                  0,
                  Math.min(100, Number(ai.confidence) || 0),
                ),
                categoryAiReason: normalizeReason(text(ai.reason)),
                categoryAiAlternatives: stringArray(ai.alternatives).slice(0, 3),
                categoryAiCandidateChoices: stringArray(
                  ai.candidateChoices,
                ).slice(0, 3),
                categoryAiCandidatePaths: stringArray(ai.candidatePaths),
                categoryAiMarketEvidence: normalizeMarketEvidence(
                  ai.marketEvidence,
                ),
                categoryAiStatus: autoApply
                  ? "auto_applied"
                  : skippedExisting
                    ? "existing_preserved"
                    : "review_required",
                categoryAiSnapshotHash: text(body?.snapshot?.hash),
                categoryAiUpdatedAt: now,
                updatedAt: now,
                updatedBy: autoApply
                  ? "AI 카테고리 자동설정"
                  : candidate.updatedBy,
              }
            : candidate,
        ),
      };
      await persistState(next);
      const newCandidates = stringArray(ai.candidateChoices).filter(Boolean);
      setNotice(
        autoApply
          ? `${item.modelNumber} · 고신뢰도 카테고리가 자동입력됐습니다.`
          : newCandidates.length
            ? `${item.modelNumber} · 모델명 핵심명사 기준 후보를 다시 생성했습니다.`
            : `${item.modelNumber} · 관련 카테고리를 찾지 못해 검토 상태로 유지했습니다.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "후보 재생성에 실패했습니다.");
    } finally {
      setBusyKey("");
    }
  }

  async function persistState(next: TrackerState) {
    const response = await fetch(STATE_ENDPOINT, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ state: next }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || "카테고리 결과를 저장하지 못했습니다.");
    }
    setState(next);
    window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(next));
  }

  if (loading) {
    return (
      <section className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm font-bold text-blue-900 shadow-sm">
        AI 검토 상품과 후보를 불러오고 있습니다.
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
        <p className="text-sm font-bold text-rose-800">{loadError}</p>
        <button
          type="button"
          onClick={() => void loadStateWithRetry()}
          className="mt-3 rounded-lg bg-rose-700 px-3 py-2 text-xs font-black text-white"
        >
          다시 불러오기
        </button>
      </section>
    );
  }

  if (!reviews.length) return null;

  return (
    <section className="mb-5 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            핵심명사 후보 검토
          </p>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            모델명에서 실제 제품명사를 먼저 찾습니다
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            모델명 웹 검색의 시장 카테고리와 핵심 제품명사를 함께 확인합니다. 관련 후보가 없으면 엉뚱한 카테고리를 제시하지 않습니다.
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">
          {reviews.length}건 검토 필요
        </span>
      </div>

      {notice ? (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-900">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {reviews.map((item) => {
          const reanalyzing = busyKey === `reanalyze:${item.itemId}`;
          return (
            <article key={item.itemId} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-black text-slate-950">
                    {item.modelNumber || "모델번호 없음"} · {item.productName || "모델명 없음"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{item.reason}</p>
                  {item.marketEvidence ? (
                    <div className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-[11px] leading-5 text-cyan-950">
                      <p className="font-black">
                        {item.marketEvidence.status === "web"
                          ? "웹 검색 근거"
                          : "웹 검색 대체 분석"} · 근거 신뢰도 {item.marketEvidence.confidence}%
                      </p>
                      {item.marketEvidence.summary ? (
                        <p>{item.marketEvidence.summary}</p>
                      ) : null}
                      {item.marketEvidence.categoryPaths.length ? (
                        <p>시장 분류: {item.marketEvidence.categoryPaths.join(" / ")}</p>
                      ) : null}
                      {item.marketEvidence.sourceDomains.length ? (
                        <p>출처: {item.marketEvidence.sourceDomains.join(", ")}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void reanalyze(item)}
                  disabled={Boolean(busyKey)}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-40"
                >
                  {reanalyzing ? "재분석 중…" : "후보 다시 생성"}
                </button>
              </div>

              {item.candidates.length ? (
                <div className="mt-3 space-y-2">
                  {item.candidates.map((candidate, index) => (
                    <div
                      key={candidate}
                      className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-[10px] font-black text-slate-400">
                          후보 {index + 1}{index === 0 ? " · AI 1순위" : ""}
                        </p>
                        <p className="mt-0.5 break-words text-xs font-bold leading-5 text-slate-800">
                          {candidate}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void approve(item, candidate)}
                        disabled={Boolean(busyKey)}
                        className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300"
                      >
                        {busyKey === `approve:${item.itemId}`
                          ? "저장 중…"
                          : "이 후보 승인"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-bold leading-5 text-rose-800">
                  기존 후보가 모델명의 핵심 제품명사와 맞지 않아 숨겼습니다. 위의 ‘후보 다시 생성’을 눌러 이 상품만 다시 분석하세요.
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function buildReviews(state: TrackerState | null): ReviewItem[] {
  if (!state || !Array.isArray(state.items)) return [];
  return state.items
    .filter((item) => {
      if (!item || item.archivedAt) return false;
      const status = text(item.categoryAiStatus);
      return status === "review_required" || status === "review_held";
    })
    .map((item) => ({
      itemId: text(item.id),
      modelNumber: text(item.modelNumber),
      productName: text(item.productName),
      confidence: Math.max(0, Math.min(100, Number(item.categoryAiConfidence) || 0)),
      reason: normalizeReason(
        text(item.categoryAiReason) ||
          "모델명과 옵션정보 기준으로 검토가 필요합니다.",
      ),
      candidates: candidateChoices(item),
      marketEvidence: normalizeMarketEvidence(item.categoryAiMarketEvidence),
    }))
    .filter((item) => item.itemId)
    .sort(
      (left, right) =>
        left.confidence - right.confidence ||
        left.modelNumber.localeCompare(right.modelNumber, "ko-KR"),
    );
}

function candidateChoices(item: TrackerItem) {
  const sources = [
    ...(Array.isArray(item.categoryAiCandidateChoices)
      ? item.categoryAiCandidateChoices
      : []),
    item.categoryAiSuggestion,
    ...(Array.isArray(item.categoryAiAlternatives)
      ? item.categoryAiAlternatives
      : []),
    ...(Array.isArray(item.categoryAiCandidatePaths)
      ? item.categoryAiCandidatePaths
      : []),
  ];
  const unique: string[] = [];
  for (const source of sources) {
    const value = text(source);
    if (!value || unique.includes(value)) continue;
    unique.push(value);
  }

  if (compact(item.productName).includes("골무")) {
    const positive = [
      "골무",
      "바느질",
      "재봉",
      "수예",
      "봉제",
      "손가락보호",
      "보호대",
      "공예",
    ];
    const blocked = [
      "타이즈",
      "스타킹",
      "내의",
      "레깅스",
      "양말",
      "속옷",
      "의류",
      "축구",
      "야구",
      "골프",
      "헬멧",
      "투구",
    ];
    return unique
      .filter((candidate) => {
        const value = compact(candidate);
        return (
          positive.some((term) => value.includes(compact(term))) &&
          !blocked.some((term) => value.includes(compact(term)))
        );
      })
      .slice(0, 3);
  }

  return unique.slice(0, 3);
}

function normalizeReason(value: string) {
  return value
    .replaceAll("상품명이", "모델명이")
    .replaceAll("상품명은", "모델명은")
    .replaceAll("상품명에", "모델명에")
    .replaceAll("상품명", "모델명");
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function normalizeMarketEvidence(value: unknown): MarketEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const status = row.status === "web" ? "web" : "model_fallback";
  const summary = text(row.summary).slice(0, 240);
  const categoryPaths = stringArray(row.categoryPaths).slice(0, 4);
  const sourceDomains = stringArray(row.sourceDomains).slice(0, 8);
  const confidence = Math.max(
    0,
    Math.min(100, Math.round(Number(row.confidence) || 0)),
  );
  if (!summary && !categoryPaths.length && !sourceDomains.length) return null;
  return { status, confidence, summary, categoryPaths, sourceDomains };
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return text(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

async function requireServerState() {
  const state = await readServerState();
  if (!state) throw new Error("최신 진행관리 데이터를 불러오지 못했습니다.");
  return state;
}

async function readServerState(): Promise<TrackerState | null> {
  try {
    const response = await fetch(STATE_ENDPOINT, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true || !Array.isArray(body.state?.items)) {
      return null;
    }
    return body.state as TrackerState;
  } catch {
    return null;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
