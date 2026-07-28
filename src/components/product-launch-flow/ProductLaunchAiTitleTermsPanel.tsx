"use client";

import { useEffect, useMemo, useState } from "react";
import {
  extractRowsWithGoodsKey,
  inferProductGroupFromPtnGoodsCd,
  type ProductLaunchUploadRow,
} from "@/lib/productLaunchFlow";
import {
  PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
  readProductLaunchSimpleSession,
  type ProductLaunchSimpleSession,
} from "@/lib/productLaunchSimpleSession";
import type { ProductLaunchAiTitleTerm } from "@/lib/productLaunchAiTitleTerms";

const AI_TITLE_TERMS_STORAGE_KEY = "productLaunchFlow.aiTitleTerms.v1";
const TITLE_INPUT_PLACEHOLDER = "쉼표로 상품명 후보 입력";

type ProductContext = {
  goodsKey: string;
  productGroup: string;
  originalTitle: string;
  currentTitle: string;
  searchKeywords: string[];
  recommendationKeywords: string[];
};

type StoredSuggestion = {
  terms: ProductLaunchAiTitleTerm[];
  generatedAt: string;
  model: string;
};

type StoredSuggestions = {
  version: 1;
  byGoodsKey: Record<string, StoredSuggestion>;
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return text(value)
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLocaleLowerCase();
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function splitTitleCandidates(value: unknown) {
  const seen = new Set<string>();
  return String(value ?? "")
    .split(/[,，、;|\n]+/)
    .map(text)
    .filter(Boolean)
    .filter((item) => {
      const identity = compact(item);
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

function splitSearchKeywords(value: unknown) {
  const seen = new Set<string>();
  return String(value ?? "")
    .split(/[,，、;|/\n]+/)
    .map(text)
    .filter(Boolean)
    .filter((item) => {
      const identity = item.toLocaleLowerCase();
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, 20);
}

function titleFromUploadRow(row: ProductLaunchUploadRow) {
  return text(
    row.final_title ??
      row.registered_title ??
      row.upload_title ??
      row.product_name ??
      row.title ??
      row.productTitle,
  );
}

function recommendationKeywordsForGoodsKey(
  session: ProductLaunchSimpleSession,
  goodsKey: string,
) {
  const groups = session.recommendationResult?.recommendations ?? [];
  const group = groups.find((item) => item.goodsKey === goodsKey);
  return (group?.items ?? [])
    .map((item) => text(item.keyword))
    .filter(Boolean)
    .slice(0, 30);
}

function buildProductContexts(session: ProductLaunchSimpleSession) {
  const rows = extractRowsWithGoodsKey(session.uploadResult);
  const seen = new Set<string>();
  const contexts: ProductContext[] = [];
  for (const row of rows) {
    const goodsKey = text(row.goods_key);
    if (!goodsKey || seen.has(goodsKey)) continue;
    seen.add(goodsKey);
    const originalTitle = titleFromUploadRow(row);
    if (!originalTitle) continue;
    contexts.push({
      goodsKey,
      productGroup: inferProductGroupFromPtnGoodsCd(row.ptn_goods_cd ?? "")
        .productGroup,
      originalTitle,
      currentTitle: text(session.titles[goodsKey]),
      searchKeywords: splitSearchKeywords(session.searches[goodsKey]),
      recommendationKeywords: recommendationKeywordsForGoodsKey(
        session,
        goodsKey,
      ),
    });
  }
  return contexts;
}

function readStoredSuggestions(): StoredSuggestions {
  try {
    const raw = window.localStorage.getItem(AI_TITLE_TERMS_STORAGE_KEY);
    if (!raw) return { version: 1, byGoodsKey: {} };
    const parsed = JSON.parse(raw) as StoredSuggestions;
    if (parsed.version !== 1 || !parsed.byGoodsKey) {
      return { version: 1, byGoodsKey: {} };
    }
    return parsed;
  } catch {
    return { version: 1, byGoodsKey: {} };
  }
}

function writeStoredSuggestions(value: StoredSuggestions) {
  window.localStorage.setItem(AI_TITLE_TERMS_STORAGE_KEY, JSON.stringify(value));
}

function findLiveTitleInput(goodsKey: string) {
  const rows = [...document.querySelectorAll<HTMLTableRowElement>("tr")];
  for (const row of rows) {
    const firstCell = row.querySelector<HTMLTableCellElement>("td");
    if (text(firstCell?.textContent) !== goodsKey) continue;
    const input = row.querySelector<HTMLInputElement>(
      `input[placeholder="${TITLE_INPUT_PLACEHOLDER}"]`,
    );
    if (input) return input;
  }
  return null;
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function updateSessionTitle(goodsKey: string, value: string) {
  try {
    const raw = window.localStorage.getItem(
      PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
    );
    if (!raw) return;
    const session = JSON.parse(raw) as Record<string, unknown>;
    const titles =
      session.titles && typeof session.titles === "object"
        ? { ...(session.titles as Record<string, unknown>) }
        : {};
    titles[goodsKey] = value;
    window.localStorage.setItem(
      PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
      JSON.stringify({
        ...session,
        titles,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // The live React input remains the source of truth if local persistence fails.
  }
}

function categoryClass(category: ProductLaunchAiTitleTerm["category"]) {
  if (category === "상품대체어") return "border-indigo-300 bg-indigo-50 text-indigo-800";
  if (category === "사용상황") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (category === "형태구성") return "border-blue-300 bg-blue-50 text-blue-800";
  if (category === "스타일") return "border-pink-300 bg-pink-50 text-pink-800";
  if (category === "사용대상") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

export function ProductLaunchAiTitleTermsPanel() {
  const [hydrated, setHydrated] = useState(false);
  const [contexts, setContexts] = useState<ProductContext[]>([]);
  const [suggestions, setSuggestions] = useState<StoredSuggestions>({
    version: 1,
    byGoodsKey: {},
  });
  const [currentTitles, setCurrentTitles] = useState<Record<string, string>>({});
  const [busyGoodsKey, setBusyGoodsKey] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});

  useEffect(() => {
    const session = readProductLaunchSimpleSession(window.localStorage);
    if (session) {
      const nextContexts = buildProductContexts(session);
      setContexts(nextContexts);
      setCurrentTitles(
        Object.fromEntries(
          nextContexts.map((context) => [context.goodsKey, context.currentTitle]),
        ),
      );
    }
    setSuggestions(readStoredSuggestions());
    setHydrated(true);
  }, []);

  const contextByGoodsKey = useMemo(
    () => new Map(contexts.map((context) => [context.goodsKey, context])),
    [contexts],
  );

  async function generate(goodsKey: string) {
    const context = contextByGoodsKey.get(goodsKey);
    if (!context || busyGoodsKey) return;
    setBusyGoodsKey(goodsKey);
    setMessages((current) => ({
      ...current,
      [goodsKey]: "상품에 어울리는 AI 생성어를 만들고 있습니다.",
    }));
    try {
      const liveTitle =
        findLiveTitleInput(goodsKey)?.value ?? currentTitles[goodsKey] ?? "";
      const response = await fetch("/api/product-launch-ai-title-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goods_key: goodsKey,
          product_group: context.productGroup,
          original_title: context.originalTitle,
          current_title_candidates: splitTitleCandidates(liveTitle),
          search_keywords: context.searchKeywords,
          recommendation_keywords: context.recommendationKeywords,
        }),
      });
      const data = (await response.json()) as {
        status?: string;
        message?: string;
        model?: string;
        terms?: ProductLaunchAiTitleTerm[];
        generatedAt?: string;
        rejectedCount?: number;
      };
      if (!response.ok || data.status !== "success" || !data.terms?.length) {
        throw new Error(data.message || "AI 생성어를 만들지 못했습니다.");
      }
      const next: StoredSuggestions = {
        version: 1,
        byGoodsKey: {
          ...suggestions.byGoodsKey,
          [goodsKey]: {
            terms: data.terms,
            generatedAt: data.generatedAt ?? new Date().toISOString(),
            model: data.model ?? "OpenAI",
          },
        },
      };
      setSuggestions(next);
      writeStoredSuggestions(next);
      setMessages((current) => ({
        ...current,
        [goodsKey]: data.rejectedCount
          ? `안전검사를 통과한 AI 생성어 ${data.terms?.length ?? 0}개를 만들었습니다. 부적합 후보 ${data.rejectedCount}개는 제외했습니다.`
          : `AI 생성어 ${data.terms?.length ?? 0}개를 만들었습니다. 원하는 단어를 눌러 상품명 후보에 추가하세요.`,
      }));
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [goodsKey]:
          error instanceof Error
            ? error.message
            : "AI 생성어 요청 중 오류가 발생했습니다.",
      }));
    } finally {
      setBusyGoodsKey("");
    }
  }

  function toggleTerm(goodsKey: string, term: ProductLaunchAiTitleTerm) {
    const input = findLiveTitleInput(goodsKey);
    const currentValue = input?.value ?? currentTitles[goodsKey] ?? "";
    const candidates = splitTitleCandidates(currentValue);
    const identity = compact(term.text);
    const exists = candidates.some((candidate) => compact(candidate) === identity);
    const nextCandidates = exists
      ? candidates.filter((candidate) => compact(candidate) !== identity)
      : [...candidates, term.text];
    const nextValue = nextCandidates.join(",");
    if (!exists && utf8Bytes(nextValue) > 100) {
      setMessages((current) => ({
        ...current,
        [goodsKey]:
          "상품명 후보가 100bytes를 넘습니다. 기존 단어를 하나 제거한 뒤 추가하세요.",
      }));
      return;
    }
    if (input) setReactInputValue(input, nextValue);
    updateSessionTitle(goodsKey, nextValue);
    setCurrentTitles((current) => ({ ...current, [goodsKey]: nextValue }));
    setMessages((current) => ({
      ...current,
      [goodsKey]: exists
        ? `'${term.text}'을 상품명 후보에서 제거했습니다.`
        : `'${term.text}'을 상품명 후보에 추가했습니다.`,
    }));
  }

  if (!hydrated || !contexts.length) return null;

  return (
    <section className="mb-6 rounded-3xl border border-fuchsia-200 bg-fuchsia-50 p-6 shadow-sm">
      <div>
        <p className="text-sm font-bold text-fuchsia-700">상품명 다양화 도구</p>
        <h2 className="mt-1 text-lg font-black text-slate-950">
          AI 생성어를 상품명 후보에 추가
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          각 상품의 실제 상품명과 키워드를 근거로 짧은 상품명 조합 단어를 만듭니다. 생성된 단어를 누르면 아래 상품명 후보 입력칸에 바로 추가되며, 다시 누르면 제거됩니다.
        </p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {contexts.map((context) => {
          const stored = suggestions.byGoodsKey[context.goodsKey];
          const selected = new Set(
            splitTitleCandidates(currentTitles[context.goodsKey]).map(compact),
          );
          return (
            <div
              key={context.goodsKey}
              className="rounded-2xl border border-fuchsia-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-slate-500">
                    {context.goodsKey} · {context.productGroup || "상품그룹 확인 필요"}
                  </p>
                  <p className="mt-1 font-black text-slate-900">
                    {context.originalTitle}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    현재 상품명 후보 {splitTitleCandidates(currentTitles[context.goodsKey]).length}개 · {utf8Bytes(currentTitles[context.goodsKey] ?? "")}/100bytes
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void generate(context.goodsKey)}
                  disabled={Boolean(busyGoodsKey)}
                  className="rounded-xl bg-fuchsia-700 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {busyGoodsKey === context.goodsKey
                    ? "AI 생성 중"
                    : stored
                      ? "AI 생성어 다시 만들기"
                      : "AI 생성어 만들기"}
                </button>
              </div>

              {stored?.terms.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {stored.terms.map((term) => {
                    const active = selected.has(compact(term.text));
                    return (
                      <button
                        key={`${context.goodsKey}:${term.text}`}
                        type="button"
                        onClick={() => toggleTerm(context.goodsKey, term)}
                        title={`${term.category} · ${term.reason}${term.evidence.length ? ` · 근거: ${term.evidence.join(", ")}` : ""}`}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${categoryClass(term.category)} ${active ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                      >
                        {term.text}
                        <span className="ml-1 opacity-65">{term.category}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-fuchsia-200 bg-fuchsia-50 px-3 py-3 text-sm text-fuchsia-800">
                  버튼을 누르면 이 상품에 맞는 상품명 조합 단어를 생성합니다.
                </p>
              )}

              {messages[context.goodsKey] ? (
                <p className="mt-3 text-xs font-bold text-fuchsia-800">
                  {messages[context.goodsKey]}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
