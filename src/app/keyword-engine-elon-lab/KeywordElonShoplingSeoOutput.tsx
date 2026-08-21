"use client";

import { useEffect, useMemo, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";
import {
  PRODUCT_GROUP_MARKET_REGISTRY,
} from "@/lib/productGroupMarketRegistry";
import {
  buildKeywordElonSeoPackage,
  type KeywordElonSeoPackage,
} from "@/lib/keywordEngineElonLabSeoOutput";

const CUSTOM_BLOCKED_STORAGE_KEY = "keywordEngineElonLab.step4.customBlockedTerms.v1";

type Step4Decision = {
  keyword?: string;
  key?: string;
  blocked?: boolean;
};

type Step4Result = {
  status?: string;
  allowedKeys?: string[];
  decisions?: Step4Decision[];
  customBlockedTerms?: string[];
};

type ExtendedSession = KeywordElonLabSession & {
  step4?: Step4Result;
};

function readSession() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    return raw ? JSON.parse(raw) as ExtendedSession : null;
  } catch {
    return null;
  }
}

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildOutput(session: ExtendedSession | null, customTerms: string[]): KeywordElonSeoPackage | null {
  if (!session?.identity || session.step4?.status !== "done") return null;
  const allowedKeys = Array.isArray(session.step4.allowedKeys) ? session.step4.allowedKeys : [];
  if (!allowedKeys.length) return null;
  const blockedKeys = (session.step4.decisions ?? [])
    .filter((row) => row.blocked === true)
    .map((row) => row.key || row.keyword || "")
    .filter(Boolean);
  return buildKeywordElonSeoPackage(
    {
      identity: session.identity,
      candidates: session.scoredCandidates,
      allowedKeys,
      blockedKeys,
      customBlockedTerms: session.step4.customBlockedTerms ?? customTerms,
      titleResult: session.step4 && "titleResult" in session.step4
        ? (session.step4 as Step4Result & { titleResult?: KeywordElonLabSession["titleResult"] }).titleResult
        : session.titleResult,
    },
    PRODUCT_GROUP_MARKET_REGISTRY,
  );
}

export default function KeywordElonShoplingSeoOutput() {
  const [session, setSession] = useState<ExtendedSession | null>(null);
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let lastSession = "";
    let lastCustom = "";
    const sync = () => {
      const rawSession = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY) || "";
      const rawCustom = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY) || "";
      if (rawSession !== lastSession) {
        lastSession = rawSession;
        setSession(readSession());
      }
      if (rawCustom !== lastCustom) {
        lastCustom = rawCustom;
        setCustomTerms(readCustomBlockedTerms());
      }
    };
    sync();
    const timer = window.setInterval(sync, 500);
    window.addEventListener("keyword-elon-session-updated", sync);
    window.addEventListener("keyword-elon-step4-custom-terms-updated", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keyword-elon-session-updated", sync);
      window.removeEventListener("keyword-elon-step4-custom-terms-updated", sync);
    };
  }, []);

  const output = useMemo(() => buildOutput(session, customTerms), [session, customTerms]);
  const grouped = useMemo(() => {
    const map = new Map<string, NonNullable<typeof output>["mallTitles"]>();
    for (const row of output?.mallTitles ?? []) {
      map.set(row.productGroup, [...(map.get(row.productGroup) ?? []), row]);
    }
    return [...map.entries()];
  }, [output]);

  if (!output) return null;

  async function copyKeywords() {
    await navigator.clipboard.writeText(output.commonSearchKeywords.join(","));
    setMessage("공통 검색어를 클립보드에 복사했습니다.");
  }

  async function copyTitles() {
    const text = output.mallTitles
      .map((row) => [row.productGroup, row.marketName, row.mallKey, row.title].join("\t"))
      .join("\n");
    await navigator.clipboard.writeText(text);
    setMessage("29개 쇼핑몰별 상품명을 표 형식으로 복사했습니다.");
  }

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify({
      sourceUrl: session?.source.url ?? "",
      offerId: session?.source.offerId ?? "",
      commonSearchKeywords: output.commonSearchKeywords,
      mallTitles: output.mallTitles,
      warnings: output.warnings,
    }, null, 2));
    setMessage("SEO OUTPUT 전체 JSON을 복사했습니다.");
  }

  return (
    <section className="mx-auto mb-6 max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-3xl border-2 border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-emerald-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-700">SEO OUTPUT · PREVIEW ONLY</div>
            <h2 className="mt-1 text-2xl font-black">쇼핑몰별 상품명 + 공통 검색어 10개</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              STEP 4 최종 통과 키워드를 최우선으로 사용해 29개 쇼핑몰별 상품명을 구성했습니다. 현재는 이 페이지에 결과만 보여주며 Shopling·상품출시진행관리·마켓에는 아무것도 쓰지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">상품명 {output.mallTitles.length}개</span>
            <span className={`rounded-full px-3 py-1 ${output.status === "ready" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900"}`}>
              검색어 {output.commonSearchKeywords.length}/10
            </span>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-800">STEP 4 재료 {output.allowedMaterialCount}개</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">외부 적용 없음</span>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-950">
          공통 상품명·모델명은 변경하지 않습니다. SEO 상품명에는 ‘도매·대량·납품’을 사용하지 않으며, 검색어 10개는 모든 상품그룹에 공통으로 쓰는 결과입니다.
        </div>

        {output.warnings.length ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="font-black">보완 안내</div>
            {output.warnings.map((warning) => <div key={warning} className="mt-1">• {warning}</div>)}
          </div>
        ) : null}

        <div className="mt-5 rounded-2xl border border-cyan-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black">공통 검색어</h3>
              <p className="mt-1 text-xs text-slate-500">
                STEP 4 시장키워드 {output.marketDerivedKeywordCount}개 우선 · 보완 조합 {output.generatedFallbackKeywordCount}개 · 띄어쓰기 없이 저장
              </p>
            </div>
            <button type="button" onClick={() => void copyKeywords()} className="rounded-xl bg-cyan-700 px-4 py-2 text-sm font-black text-white">
              검색어 복사
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {output.commonSearchKeywords.map((keyword, index) => (
              <span key={keyword} className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-black text-cyan-950">
                <span className="mr-1 text-xs text-cyan-600">#{index + 1}</span>{keyword}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">쇼핑몰별 상품명</h3>
            <p className="mt-1 text-xs text-slate-500">상품그룹별 SEO 순서와 쇼핑몰별 안정적 변형을 적용했습니다. 각 제목은 UTF-8 100bytes 이하입니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyTitles()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">상품명 표 복사</button>
            <button type="button" onClick={() => void copyJson()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">전체 JSON 복사</button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {grouped.map(([group, rows]) => (
            <details key={group} className="rounded-2xl border border-slate-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-black">
                <span>{group} · {rows.length}개 쇼핑몰</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">펼쳐보기</span>
              </summary>
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3">쇼핑몰</th>
                      <th className="px-4 py-3">쇼핑몰ID</th>
                      <th className="min-w-[620px] px-4 py-3">SEO 상품명</th>
                      <th className="px-4 py-3 text-right">bytes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => (
                      <tr key={`${row.productGroup}:${row.mallKey}:${row.accountIdLabel}`}>
                        <td className="whitespace-nowrap px-4 py-3"><div className="font-black">{row.marketName}</div><div className="mt-1 text-[11px] text-slate-400">{row.accountIdLabel}</div></td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{row.mallKey}</td>
                        <td className="px-4 py-3 font-bold text-slate-900">{row.title}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-black tabular-nums">{row.byteLength}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>고유 상품명 {output.uniqueTitleCount}/{output.mallTitles.length}개</span>
          {message ? <span className="font-bold text-blue-800">{message}</span> : null}
        </div>
      </div>
    </section>
  );
}
