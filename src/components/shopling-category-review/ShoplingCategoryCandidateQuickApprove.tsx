"use client";

import { useEffect, useMemo, useState } from "react";
import { applyShoplingCategoryReviewDecisions } from "@/lib/shoplingCategoryReview";

const STATE_ENDPOINT = "/api/product-launch-tracker/state";
const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";

type TrackerItem = Record<string, unknown> & {
  id?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  archivedAt?: unknown;
  categoryAiStatus?: unknown;
  categoryAiSuggestion?: unknown;
  categoryAiAlternatives?: unknown;
  categoryAiCandidateChoices?: unknown;
  categoryAiCandidatePaths?: unknown;
  categoryAiReason?: unknown;
  categoryAiConfidence?: unknown;
};

type TrackerState = Record<string, unknown> & { items: TrackerItem[] };

type CandidateReview = {
  itemId: string;
  modelNumber: string;
  productName: string;
  confidence: number;
  reason: string;
  candidates: string[];
};

export function ShoplingCategoryCandidateQuickApprove() {
  const [state, setState] = useState<TrackerState | null>(null);
  const [busyItemId, setBusyItemId] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void loadState();
    const normalizeVisibleTerminology = () => {
      for (const element of document.querySelectorAll("table p, table span")) {
        if (!(element instanceof HTMLElement)) continue;
        const value = element.textContent ?? "";
        if (value.includes("상품명")) {
          element.textContent = normalizeReason(value);
        }
      }
    };
    normalizeVisibleTerminology();
    const observer = new MutationObserver(normalizeVisibleTerminology);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const reviews = useMemo(() => buildReviews(state), [state]);
  if (!reviews.length) return null;

  async function loadState() {
    const next = await readServerState();
    if (next) setState(next);
  }

  async function approve(item: CandidateReview, category: string) {
    if (busyItemId) return;
    setBusyItemId(item.itemId);
    setNotice("");
    try {
      const latest = await readServerState();
      if (!latest) throw new Error("최신 진행관리 데이터를 불러오지 못했습니다.");
      const result = applyShoplingCategoryReviewDecisions(
        latest,
        [{ itemId: item.itemId, action: "approve", category }],
        { reviewer: "AI 카테고리 검토함" },
      );
      const response = await fetch(STATE_ENDPOINT, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ state: result.state }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok !== true) {
        throw new Error(body?.message || "후보 카테고리를 저장하지 못했습니다.");
      }
      const saved = result.state as TrackerState;
      setState(saved);
      window.localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(saved));
      setNotice(`${item.modelNumber || item.productName} · 선택한 후보로 승인했습니다.`);
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "후보 승인에 실패했습니다.");
    } finally {
      setBusyItemId("");
    }
  }

  return (
    <section className="mb-5 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            빠른 후보 승인
          </p>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            검토 필요 상품마다 서로 다른 후보를 약 3개 표시합니다
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            경로를 확인한 뒤 원하는 후보의 ‘이 후보 승인’을 누르면 진행관리 카테고리에 즉시 저장됩니다.
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
        {reviews.map((item) => (
          <article key={item.itemId} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-black text-slate-950">
                  {item.modelNumber || "모델번호 없음"} · {item.productName || "모델명 없음"}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{item.reason}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
                item.confidence >= 70
                  ? "bg-amber-50 text-amber-700"
                  : "bg-rose-50 text-rose-700"
              }`}>
                신뢰도 {item.confidence}%
              </span>
            </div>

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
                    disabled={Boolean(busyItemId)}
                    className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:bg-slate-300"
                  >
                    {busyItemId === item.itemId ? "저장 중…" : "이 후보 승인"}
                  </button>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function buildReviews(state: TrackerState | null): CandidateReview[] {
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
      reason: normalizeReason(text(item.categoryAiReason) || "모델명과 옵션정보 기준으로 검토가 필요합니다."),
      candidates: candidateChoices(item),
    }))
    .filter((item) => item.itemId && item.candidates.length)
    .sort((left, right) => left.confidence - right.confidence || left.modelNumber.localeCompare(right.modelNumber, "ko-KR"));
}

function candidateChoices(item: TrackerItem) {
  const sources = [
    ...(Array.isArray(item.categoryAiCandidateChoices) ? item.categoryAiCandidateChoices : []),
    item.categoryAiSuggestion,
    ...(Array.isArray(item.categoryAiAlternatives) ? item.categoryAiAlternatives : []),
    ...(Array.isArray(item.categoryAiCandidatePaths) ? item.categoryAiCandidatePaths : []),
  ];
  const unique: string[] = [];
  for (const source of sources) {
    const value = text(source);
    if (!value || unique.includes(value)) continue;
    unique.push(value);
    if (unique.length >= 3) break;
  }
  return unique;
}

function normalizeReason(value: string) {
  return value
    .replaceAll("상품명이", "모델명이")
    .replaceAll("상품명은", "모델명은")
    .replaceAll("상품명에", "모델명에")
    .replaceAll("상품명", "모델명");
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function readServerState(): Promise<TrackerState | null> {
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
}
