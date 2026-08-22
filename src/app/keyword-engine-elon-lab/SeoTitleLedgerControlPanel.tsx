"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "@/lib/productGroupMarketRegistry";
import {
  buildKeywordElonSeoModelPackage,
  type KeywordElonSeoModelPackage,
} from "@/lib/keywordEngineElonLabSeoModelOutput";
import {
  SEO_TITLE_LEDGER_LAUNCH_CONTEXT_EVENT,
  SEO_TITLE_LEDGER_LAUNCH_CONTEXT_KEY,
  readSeoTitleLedgerLaunchContext,
  type SeoTitleLedgerLaunchContext,
} from "./SeoTitleLedgerLaunchHandoff";

const CUSTOM_BLOCKED_STORAGE_KEY =
  "keywordEngineElonLab.step4.customBlockedTerms.v1";

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
  titleResult?: KeywordElonLabSession["titleResult"];
};

type ExtendedSession = KeywordElonLabSession & {
  step4?: Step4Result;
};

type LedgerStats = {
  ledger_id: string;
  launch_item_id: string;
  model_number: string;
  source_url: string;
  offer_id: string;
  model_name: string;
  target_inventory_count: number;
  total_count: number;
  available_count: number;
  reserved_count: number;
  used_count: number;
  review_count: number;
  full_market_rounds_available: number;
  replenishment_needed_count: number;
  dispatch_count: number;
  status: string;
};

type LedgerSaveResponse = {
  ok?: boolean;
  message?: string;
  insertedCount?: number;
  shortageGroups?: string[];
  generationWarnings?: string[];
  detail?: {
    stats?: LedgerStats | null;
  } | null;
};

function readSession() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ExtendedSession) : null;
  } catch {
    return null;
  }
}

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildOutput(
  session: ExtendedSession | null,
  customTerms: string[],
): KeywordElonSeoModelPackage | null {
  if (!session?.identity || session.step4?.status !== "done") return null;
  const allowedKeys = Array.isArray(session.step4.allowedKeys)
    ? session.step4.allowedKeys
    : [];
  if (!allowedKeys.length) return null;
  const blockedKeys = (session.step4.decisions ?? [])
    .filter((row) => row.blocked === true)
    .map((row) => row.key || row.keyword || "")
    .filter(Boolean);
  return buildKeywordElonSeoModelPackage(
    {
      identity: session.identity,
      candidates: session.scoredCandidates,
      allowedKeys,
      blockedKeys,
      customBlockedTerms: session.step4.customBlockedTerms ?? customTerms,
      titleResult: session.step4.titleResult ?? session.titleResult,
    },
    PRODUCT_GROUP_MARKET_REGISTRY,
  );
}

function matchesLedger(
  row: LedgerStats,
  session: ExtendedSession | null,
  context: SeoTitleLedgerLaunchContext | null,
) {
  if (context?.launchItemId && row.launch_item_id === context.launchItemId) {
    return true;
  }
  if (session?.source.offerId && row.offer_id === session.source.offerId) {
    return true;
  }
  return Boolean(session?.source.url && row.source_url === session.source.url);
}

export default function SeoTitleLedgerControlPanel() {
  const [session, setSession] = useState<ExtendedSession | null>(null);
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [launchContext, setLaunchContext] =
    useState<SeoTitleLedgerLaunchContext | null>(null);
  const [rounds, setRounds] = useState(5);
  const [ledger, setLedger] = useState<LedgerStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let lastSession = "";
    let lastCustom = "";
    let lastContext = "";

    const sync = () => {
      const rawSession =
        window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY) || "";
      const rawCustom =
        window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY) || "";
      const rawContext =
        window.localStorage.getItem(SEO_TITLE_LEDGER_LAUNCH_CONTEXT_KEY) || "";

      if (rawSession !== lastSession) {
        lastSession = rawSession;
        setSession(readSession());
      }
      if (rawCustom !== lastCustom) {
        lastCustom = rawCustom;
        setCustomTerms(readCustomBlockedTerms());
      }
      if (rawContext !== lastContext) {
        lastContext = rawContext;
        setLaunchContext(readSeoTitleLedgerLaunchContext());
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === KEYWORD_ELON_V2_STORAGE_KEY ||
        event.key === CUSTOM_BLOCKED_STORAGE_KEY ||
        event.key === SEO_TITLE_LEDGER_LAUNCH_CONTEXT_KEY
      ) {
        sync();
      }
    };

    const frame = window.requestAnimationFrame(sync);
    window.addEventListener("keyword-elon-session-updated", sync);
    window.addEventListener("keyword-elon-step4-custom-terms-updated", sync);
    window.addEventListener(SEO_TITLE_LEDGER_LAUNCH_CONTEXT_EVENT, sync);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keyword-elon-session-updated", sync);
      window.removeEventListener("keyword-elon-step4-custom-terms-updated", sync);
      window.removeEventListener(SEO_TITLE_LEDGER_LAUNCH_CONTEXT_EVENT, sync);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const output = useMemo(
    () => buildOutput(session, customTerms),
    [session, customTerms],
  );

  const refreshLedger = useCallback(async () => {
    if (!session?.source.url) return;
    const lookupKey = session.source.offerId || launchContext?.modelNumber || "";
    if (!lookupKey) return;

    try {
      const query = new URLSearchParams({
        search: lookupKey,
        limit: "5",
      });
      const response = await fetch(`/api/seo-title-ledger?${query.toString()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        ledgers?: LedgerStats[];
      };
      if (!response.ok || payload.ok !== true) return;
      const found = (payload.ledgers ?? []).find((row) =>
        matchesLedger(row, session, launchContext),
      );
      setLedger(found ?? null);
      if (found?.target_inventory_count) {
        setRounds(
          Math.max(1, Math.round(found.target_inventory_count / 29)),
        );
      }
    } catch {
      // Ledger lookup is supplementary; current keyword work remains usable.
    }
  }, [launchContext, session]);

  useEffect(() => {
    if (!output || !session?.source.url) return;
    const timer = window.setTimeout(() => void refreshLedger(), 0);
    return () => window.clearTimeout(timer);
  }, [output, refreshLedger, session?.source.url]);

  async function manufactureInventory() {
    if (!output || !session?.identity || !session.step4?.allowedKeys?.length) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage(
      `${rounds}회분 · ${rounds * 29}개 목표로 미사용 상품명 재고를 제조하고 있습니다…`,
    );
    try {
      const response = await fetch("/api/seo-title-ledger", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: ledger ? "replenish" : "save_inventory",
          launchItemId: launchContext?.launchItemId ?? "",
          trackerRowNumber: launchContext?.trackerRowNumber ?? null,
          modelNumber: launchContext?.modelNumber ?? "",
          sourceUrl: session.source.url,
          offerId: session.source.offerId,
          rounds,
          seoOutput: {
            modelName: output.modelName,
            modelNameSource: output.modelNameSource,
            commonSearchKeywords: output.commonSearchKeywords,
            commonSearchLine: output.commonSearchLine,
            searchKeywordDetails: output.searchKeywordDetails,
          },
          sourcePayload: {
            source: session.source,
            identity: session.identity,
            candidates: session.scoredCandidates,
            allowedKeys: session.step4.allowedKeys,
            decisions: session.step4.decisions ?? [],
            customBlockedTerms:
              session.step4.customBlockedTerms ?? customTerms,
            titleResult:
              session.step4.titleResult ?? session.titleResult ?? null,
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as LedgerSaveResponse;
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message || "상품명 재고를 저장하지 못했습니다.");
      }
      const nextStats = payload.detail?.stats ?? null;
      setLedger(nextStats);
      const shortage = payload.shortageGroups?.length
        ? ` · 재료 부족 그룹 ${payload.shortageGroups.join(", ")}`
        : "";
      setMessage(
        `원장 저장 완료 · 이번 추가 ${payload.insertedCount ?? 0}개 · 사용 가능 ${nextStats?.available_count ?? 0}개 · 전체몰 ${nextStats?.full_market_rounds_available ?? 0}회분${shortage}`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "상품명 재고 제조에 실패했습니다.",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  if (!output) return null;

  const available = ledger?.available_count ?? 0;
  const target = rounds * 29;

  return (
    <section className="mx-auto mb-6 max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-3xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">
              PERSISTENT TITLE INVENTORY
            </div>
            <h2 className="mt-1 text-2xl font-black">
              SEO 상품명 재고 원장에 제조·저장
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              현재 링크의 모델명·검색어·STEP 4 재료로 중복 없는 상품명을 제조해
              Supabase 원장에 영구 보관합니다. 한 번 사용한 제목과 사실상 같은
              단어 조합은 다음 제조에서 다시 발급하지 않습니다.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs font-black sm:grid-cols-4">
            <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-indigo-100">
              <div className="text-slate-400">총 제조</div>
              <div className="mt-1 text-lg text-slate-950">
                {ledger?.total_count ?? 0}
              </div>
            </div>
            <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-indigo-100">
              <div className="text-slate-400">미사용</div>
              <div className="mt-1 text-lg text-emerald-700">{available}</div>
            </div>
            <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-indigo-100">
              <div className="text-slate-400">사용 완료</div>
              <div className="mt-1 text-lg text-blue-700">
                {ledger?.used_count ?? 0}
              </div>
            </div>
            <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-indigo-100">
              <div className="text-slate-400">전체몰 가능</div>
              <div className="mt-1 text-lg text-violet-700">
                {ledger?.full_market_rounds_available ?? 0}회
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 rounded-2xl border border-indigo-100 bg-white p-5 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <div>
            <div className="text-sm font-black">현재 원장 상품</div>
            <div className="mt-1 text-lg font-black text-indigo-950">
              {output.modelName}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {launchContext?.modelNumber
                ? `${launchContext.modelNumber} · 상품출시 진행관리 연결`
                : "1688 링크 단독 원장"}
              {ledger ? ` · 누적 출고 계획 ${ledger.dispatch_count}회` : ""}
            </div>
          </div>
          <label className="text-sm font-black">
            목표 재고
            <select
              value={rounds}
              onChange={(event) => setRounds(Number(event.target.value))}
              disabled={busy}
              className="mt-2 block min-w-40 rounded-xl border border-slate-300 bg-white px-4 py-3"
            >
              {Array.from({ length: 20 }, (_, index) => index + 1).map(
                (value) => (
                  <option key={value} value={value}>
                    전체몰 {value}회분 · {value * 29}개
                  </option>
                ),
              )}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void manufactureInventory()}
            disabled={busy || output.commonSearchKeywords.length !== 10}
            className="rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy
              ? "재고 제조 중…"
              : ledger
                ? `${target}개 목표까지 보충`
                : `${target}개 제조·원장 생성`}
          </button>
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
            {error}
          </div>
        ) : null}

        <div className="mt-4 text-xs leading-5 text-slate-500">
          원장 재고는 `미사용 → 예약 → 사용완료`로 이동합니다. 현재 단계에서는
          상품명을 제조·보관하며, 실제 샵플링 출고는 별도 `샵플링 SEO
          출고센터`에서 수행합니다.
        </div>
      </div>
    </section>
  );
}
