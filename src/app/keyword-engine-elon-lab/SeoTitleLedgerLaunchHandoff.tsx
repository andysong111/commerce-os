"use client";

import { useEffect, useState } from "react";
import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  emptyKeywordElonSession,
  parse1688OfferId,
  validate1688Url,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";

export const SEO_TITLE_LEDGER_LAUNCH_CONTEXT_KEY =
  "commerceOs.seoTitleLedger.launchContext.v1";

export type SeoTitleLedgerLaunchContext = {
  launchItemId: string;
  trackerRowNumber: number | null;
  modelNumber: string;
  sourceUrl: string;
  handedOffAt: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function readSession() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KeywordElonLabSession) : null;
  } catch {
    return null;
  }
}

export function readSeoTitleLedgerLaunchContext() {
  try {
    const raw = window.localStorage.getItem(
      SEO_TITLE_LEDGER_LAUNCH_CONTEXT_KEY,
    );
    return raw ? (JSON.parse(raw) as SeoTitleLedgerLaunchContext) : null;
  } catch {
    return null;
  }
}

export default function SeoTitleLedgerLaunchHandoff() {
  const [context, setContext] = useState<SeoTitleLedgerLaunchContext | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sourceUrl = text(params.get("sourceUrl"));
    const launchItemId = text(params.get("launchItemId"));
    const modelNumber = text(params.get("modelNumber"));
    const trackerRow = Number(params.get("trackerRowNumber"));

    if (!sourceUrl || !validate1688Url(sourceUrl)) {
      setContext(readSeoTitleLedgerLaunchContext());
      return;
    }

    const nextContext: SeoTitleLedgerLaunchContext = {
      launchItemId,
      trackerRowNumber:
        Number.isSafeInteger(trackerRow) && trackerRow > 0 ? trackerRow : null,
      modelNumber,
      sourceUrl,
      handedOffAt: new Date().toISOString(),
    };
    window.localStorage.setItem(
      SEO_TITLE_LEDGER_LAUNCH_CONTEXT_KEY,
      JSON.stringify(nextContext),
    );

    const current = readSession();
    const currentOffer = current?.source.offerId || parse1688OfferId(current?.source.url || "");
    const nextOffer = parse1688OfferId(sourceUrl);
    if (!current || !currentOffer || currentOffer !== nextOffer) {
      const session = emptyKeywordElonSession();
      session.source = {
        ...session.source,
        url: sourceUrl,
        offerId: nextOffer,
        autoStatus: "idle",
      };
      session.lastMessage = modelNumber
        ? `${modelNumber} 상품의 1688 링크를 상품출시 진행관리에서 불러왔습니다. FINAL RESULT 받기를 눌러 원장 재료를 생성하세요.`
        : "상품출시 진행관리의 1688 링크를 불러왔습니다. FINAL RESULT 받기를 눌러 원장 재료를 생성하세요.";
      session.updatedAt = new Date().toISOString();
      window.localStorage.setItem(
        KEYWORD_ELON_V2_STORAGE_KEY,
        JSON.stringify(session),
      );
      window.dispatchEvent(new CustomEvent("keyword-elon-session-updated"));
    }
    setContext(nextContext);
  }, []);

  if (!context?.sourceUrl) return null;

  return (
    <section className="mx-auto mb-4 max-w-[1500px] px-5 pt-5 text-slate-900">
      <div className="flex flex-col gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.14em] text-indigo-700">
            상품출시 진행관리 연결
          </div>
          <div className="mt-1 font-black text-slate-950">
            {context.modelNumber || "신규 상품"}
            {context.trackerRowNumber ? ` · ${context.trackerRowNumber}행` : ""}
          </div>
          <p className="mt-1 break-all text-xs text-slate-600">
            {context.sourceUrl}
          </p>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-xs font-black text-indigo-800 ring-1 ring-indigo-200">
          링크 자동 입력 완료
        </div>
      </div>
    </section>
  );
}
