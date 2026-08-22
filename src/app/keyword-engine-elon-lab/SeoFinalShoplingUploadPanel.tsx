"use client";

import { useEffect, useMemo, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";
import {
  buildKeywordElonSeoModelPackage,
  type KeywordElonSeoModelPackage,
} from "@/lib/keywordEngineElonLabSeoModelOutput";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "@/lib/productGroupMarketRegistry";
import {
  readSeoTitleLedgerLaunchContext,
  SEO_TITLE_LEDGER_LAUNCH_CONTEXT_EVENT,
  SEO_TITLE_LEDGER_LAUNCH_CONTEXT_KEY,
} from "./SeoTitleLedgerLaunchHandoff";

const CUSTOM_BLOCKED_STORAGE_KEY =
  "keywordEngineElonLab.step4.customBlockedTerms.v1";
const TRACKER_STATE_ENDPOINT = "/api/product-launch-tracker/state";
const SHOPLING_UPLOAD_ENDPOINT = "/api/product-launch-tracker/shopling-upload";

const SHOPLING_GROUPS = [
  { key: "wholesale1", label: "도매1" },
  { key: "wholesale2", label: "도매2" },
  { key: "wholesale3", label: "도매3" },
  { key: "wholesale4", label: "도매4" },
  { key: "retail1", label: "소매1" },
  { key: "retail2", label: "소매2" },
] as const;

type UnknownRecord = Record<string, unknown>;
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
type ExtendedSession = KeywordElonLabSession & { step4?: Step4Result };

type SeoFinal = {
  productName: string;
  groupProductNames: Record<string, string>;
  searchKeywords: string[];
  searchLine: string;
  source: string;
  sourceUrl: string;
  offerId: string;
  generatedAt: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

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
    throw new Error(text(body.message) || `요청 실패 · HTTP ${response.status}`);
  }
  return body;
}

export default function SeoFinalShoplingUploadPanel() {
  const [session, setSession] = useState<ExtendedSession | null>(null);
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [launchItemId, setLaunchItemId] = useState("");
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
        setLaunchItemId(readSeoTitleLedgerLaunchContext()?.launchItemId ?? "");
      }
    };
    sync();
    const timer = window.setInterval(sync, 500);
    window.addEventListener("keyword-elon-session-updated", sync);
    window.addEventListener("keyword-elon-step4-custom-terms-updated", sync);
    window.addEventListener(SEO_TITLE_LEDGER_LAUNCH_CONTEXT_EVENT, sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keyword-elon-session-updated", sync);
      window.removeEventListener("keyword-elon-step4-custom-terms-updated", sync);
      window.removeEventListener(SEO_TITLE_LEDGER_LAUNCH_CONTEXT_EVENT, sync);
    };
  }, []);

  const output = useMemo(
    () => buildOutput(session, customTerms),
    [session, customTerms],
  );

  const seoFinal = useMemo<SeoFinal | null>(() => {
    if (!output) return null;
    const groupProductNames = Object.fromEntries(
      SHOPLING_GROUPS.map((group) => {
        const title = output.mallTitles.find(
          (row) => row.productGroup === group.label,
        )?.title;
        return [group.key, text(title)];
      }),
    );
    return {
      productName: output.modelName,
      groupProductNames,
      searchKeywords: [...output.commonSearchKeywords],
      searchLine: output.commonSearchKeywords.join(","),
      source: "keyword-engine-elon-lab",
      sourceUrl: session?.source.url ?? "",
      offerId: session?.source.offerId ?? "",
      generatedAt: new Date().toISOString(),
    };
  }, [output, session?.source.offerId, session?.source.url]);

  if (!output || !seoFinal) return null;

  const groupTitlesReady = SHOPLING_GROUPS.every((group) =>
    Boolean(seoFinal.groupProductNames[group.key]),
  );
  const ready =
    output.status === "ready" &&
    seoFinal.searchKeywords.length === 10 &&
    groupTitlesReady;

  async function persistSeoFinal() {
    if (!launchItemId || !seoFinal) {
      throw new Error(
        "상품출시 진행관리에서 선택해 들어온 상품 연결정보가 없습니다.",
      );
    }
    const stateResponse = await requestJson<{
      ok?: boolean;
      state?: unknown;
      schemaVersion?: unknown;
      message?: unknown;
    }>(TRACKER_STATE_ENDPOINT);
    const state = record(stateResponse.state);
    const items = Array.isArray(state.items) ? state.items.map(record) : [];
    const item = items.find((candidate) => text(candidate.id) === launchItemId);
    if (!item) {
      throw new Error(
        "상품출시 진행관리 서버 저장본에서 선택 상품을 찾지 못했습니다.",
      );
    }
    const products = Object.values(record(item.shoplingProducts)).map(record);
    if (products.some((product) => text(product.goodsKey))) {
      throw new Error(
        "이미 등록된 Shopling goods_key가 있어 중복 등록을 차단했습니다.",
      );
    }

    const now = new Date().toISOString();
    const updatedItem = {
      ...item,
      seoFinal: { ...seoFinal, generatedAt: now },
      updatedAt: now,
      updatedBy: "SEO Cloud",
    };
    await requestJson<{ ok?: boolean; message?: unknown }>(TRACKER_STATE_ENDPOINT, {
      method: "PUT",
      body: JSON.stringify({
        state: {
          schemaVersion: Number(state.schemaVersion ?? stateResponse.schemaVersion ?? 3) || 3,
          savedAt: now,
          items: [updatedItem],
          partialPage: true,
          partialItemIds: [launchItemId],
        },
      }),
    });
  }

  async function pollUpload(jobId: string) {
    for (let poll = 0; poll < 120; poll += 1) {
      await wait(poll === 0 ? 1500 : 5000);
      const query = new URLSearchParams({ jobId });
      const result = await requestJson<{
        ok?: boolean;
        job?: unknown;
        message?: unknown;
      }>(`${SHOPLING_UPLOAD_ENDPOINT}?${query.toString()}`);
      const job = record(result.job);
      const status = text(job.status);
      if (status === "queued") {
        setMessage("Shopling 실제 등록 실행 대기 중입니다.");
        continue;
      }
      if (status === "running") {
        setMessage("도매1~소매2 6개 상품을 Shopling에 실제 등록 중입니다.");
        continue;
      }
      if (status === "success") {
        setMessage(
          "Shopling 6채널 실제 등록이 완료되었습니다. goods_key와 상품출시 진행관리 상태도 자동 반영되었습니다.",
        );
        return;
      }
      if (status === "partial_failure" || status === "failed") {
        throw new Error(
          text(job.error_message) ||
            "Shopling 등록 중 일부 또는 전체 채널이 실패했습니다.",
        );
      }
    }
    throw new Error(
      "등록 작업이 장시간 진행 중입니다. 상품출시 진행관리의 Shopling 등록 결과를 확인하세요.",
    );
  }

  async function upload() {
    if (busy) return;
    setError("");
    setMessage("");
    if (!launchItemId) {
      setError(
        "상품출시 진행관리에서 상품 1개를 선택한 뒤 SEO Cloud로 들어와야 실제 등록할 수 있습니다.",
      );
      return;
    }
    if (!ready) {
      setError(
        "SEO FINAL이 아직 등록 기준을 충족하지 못했습니다. 상품명 6개와 검색어 10개를 먼저 확정하세요.",
      );
      return;
    }
    const confirmed = window.confirm(
      "현재 SEO FINAL 상품명과 검색어 10개를 확정 저장하고 Shopling에 도매1~소매2 상품 6개를 실제 등록할까요?\n\n이미 goods_key가 있는 상품은 중복 등록하지 않습니다.",
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      setMessage("SEO FINAL 상품명·검색어 10개를 상품출시 진행관리에 확정 저장 중입니다.");
      await persistSeoFinal();
      setMessage("기존 Shopling 상품 업로드 엔진을 호출하는 중입니다.");
      const started = await requestJson<{
        ok?: boolean;
        jobId?: unknown;
        message?: unknown;
      }>(SHOPLING_UPLOAD_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ itemId: launchItemId }),
      });
      const jobId = text(started.jobId);
      if (!jobId) throw new Error("Shopling 등록 작업 ID를 받지 못했습니다.");
      setMessage("Shopling 실제 등록 작업이 시작되었습니다.");
      await pollUpload(jobId);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Shopling 실제 등록을 완료하지 못했습니다.",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto mb-6 max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-3xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
              SEO FINAL → REAL SHOPLING UPLOAD
            </div>
            <h2 className="mt-1 text-2xl font-black">
              SEO 확정값으로 Shopling 6채널 실제 등록
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              상품출시 진행관리의 기존 카테고리·가격·옵션·바코드·상세페이지·이미지는 그대로 재사용하고,
              이 화면에서 확정한 상품명과 공통 검색어 10개만 결합해 기존 Shopling 상품 업로드 엔진으로 전송합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className={`rounded-full px-3 py-1 ${ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
              {ready ? "SEO FINAL 준비완료" : "SEO FINAL 확인필요"}
            </span>
            <span className="rounded-full bg-cyan-100 px-3 py-1 text-cyan-900">
              검색어 {seoFinal.searchKeywords.length}/10
            </span>
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-900">
              Shopling 상품명 {Object.values(seoFinal.groupProductNames).filter(Boolean).length}/6
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {SHOPLING_GROUPS.map((group) => (
            <div key={group.key} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-black text-slate-500">{group.label}</div>
              <div className="mt-1 font-black text-slate-950">
                {seoFinal.groupProductNames[group.key] || "상품명 확인 필요"}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-cyan-200 bg-white p-4">
          <div className="text-xs font-black text-cyan-700">SHOPLING 검색어 · site_srch</div>
          <div className="mt-2 break-words font-mono text-sm font-bold text-cyan-950">
            {seoFinal.searchLine}
          </div>
        </div>

        {!launchItemId ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
            실제 등록은 상품출시 진행관리에서 상품 1개를 선택해 SEO Cloud로 들어온 경우에만 활성화됩니다.
          </div>
        ) : null}
        {message ? (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-950">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-xs leading-5 text-slate-500">
            실제 외부 등록 작업입니다. 실행 전 중복 goods_key를 검사하며, 성공 시 상품출시 진행관리의 Shopling 업로드 단계가 자동 완료 처리됩니다.
          </p>
          <button
            type="button"
            onClick={() => void upload()}
            disabled={busy || !ready || !launchItemId}
            className="rounded-xl bg-emerald-700 px-6 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? "실제 등록 진행 중…" : "SEO 확정 → Shopling 6채널 실제등록"}
          </button>
        </div>
      </div>
    </section>
  );
}
