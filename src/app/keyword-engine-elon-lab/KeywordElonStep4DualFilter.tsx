"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonLabSession,
  type KeywordElonTitleResult,
} from "@/lib/keywordEngineElonLabV2";
import {
  readKeywordElonSelectionThresholds,
  selectKeywordElonAccuracyCandidates,
  selectKeywordElonDemandCandidates,
  selectKeywordElonStep4Union,
  type KeywordElonSelectionThresholds,
} from "@/lib/keywordEngineElonLabV2Selection";
import type {
  KeywordElonStep4Decision,
  KeywordElonStep4FilterResult,
  KeywordElonStep4RiskCategory,
} from "@/lib/keywordEngineElonLabV2Step4";

const CUSTOM_BLOCKED_STORAGE_KEY = "keywordEngineElonLab.step4.customBlockedTerms.v1";
const AUTO_RUN_KEY = "keywordEngineElonLab.autoRunToStep4.v1";

type ApiRecord = Record<string, unknown> & { ok?: boolean; error?: unknown; errorStage?: unknown };
type Step3Meta = { status: string; round: number };
type Step4Meta = KeywordElonStep4FilterResult & {
  status: "running" | "done" | "error";
  inputFingerprint: string;
  customBlockedTerms: string[];
  titleResult: KeywordElonTitleResult | null;
  lastMessage: string;
  updatedAt: string;
};
type ExtendedSession = KeywordElonLabSession & { step3?: Step3Meta; step4?: Step4Meta };

const CATEGORY_LABEL: Record<KeywordElonStep4RiskCategory, string> = {
  trademark: "등록상표",
  medical_device: "의료기기",
  pregnancy: "임산부",
  baby: "유아용품",
  adult: "성인",
  custom: "사용자 금지어",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function requestLab<T extends ApiRecord>(body: Record<string, unknown>) {
  const response = await fetch("/api/keyword-engine-elon-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`서버가 JSON이 아닌 응답을 반환했습니다. HTTP ${response.status}: ${raw.slice(0, 220)}`);
  }
  if (!isRecord(payload)) throw new Error(`서버 응답 형식이 올바르지 않습니다. HTTP ${response.status}`);
  if (!response.ok || payload.ok !== true) {
    const stage = typeof payload.errorStage === "string" ? payload.errorStage : "request";
    const message = typeof payload.error === "string" ? payload.error : `요청 실패 · HTTP ${response.status}`;
    throw new Error(message.startsWith("[") ? message : `[${stage}] ${message}`);
  }
  return payload as T;
}

function readSession() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    return raw ? JSON.parse(raw) as ExtendedSession : null;
  } catch {
    return null;
  }
}

function writeSession(session: ExtendedSession) {
  window.localStorage.setItem(KEYWORD_ELON_V2_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent("keyword-elon-session-updated"));
}

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return uniqueKeywordElonCanonical(Array.isArray(parsed) ? parsed : [], 120).filter((term) => term.length >= 2);
  } catch {
    return [];
  }
}

function saveCustomBlockedTerms(terms: string[]) {
  window.localStorage.setItem(CUSTOM_BLOCKED_STORAGE_KEY, JSON.stringify(terms));
  window.dispatchEvent(new CustomEvent("keyword-elon-step4-custom-terms-updated"));
}

function oneClickRunning() {
  try {
    const raw = window.localStorage.getItem(AUTO_RUN_KEY);
    if (!raw) return false;
    const marker = JSON.parse(raw) as { status?: string };
    return marker.status === "armed" || marker.status === "running";
  } catch {
    return false;
  }
}

function candidateKey(row: KeywordElonCandidate) {
  return compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword);
}

function fingerprint(
  candidates: KeywordElonCandidate[],
  thresholds: KeywordElonSelectionThresholds,
  customTerms: string[],
  round: number,
) {
  return [
    "dual-selection:v1",
    `demandQuality:${thresholds.demandQuality}`,
    `accuracyRelevance:${thresholds.accuracyRelevance}`,
    `round:${round}`,
    `custom:${customTerms.join(",")}`,
    ...candidates.map((row) => `${candidateKey(row)}:${row.qualityScore.toFixed(2)}:${row.relevance.toFixed(0)}`),
  ].join("|");
}

function KeywordCard({ row }: { row: KeywordElonCandidate }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm">
      <div>
        <div className="font-black">{row.searchKeyword || row.searchKey || row.keyword}</div>
        <div className="mt-1 text-xs text-slate-500">관련성 {row.relevance.toFixed(0)} · 쇼핑의도 {row.shoppingIntent.toFixed(0)} · 품질 {row.qualityScore.toFixed(1)}</div>
      </div>
      <div className="text-right"><div className="font-black tabular-nums">{row.totalSearch === null ? "—" : row.totalSearch.toLocaleString()}</div><div className="text-[11px] text-slate-400">월검색</div></div>
    </div>
  );
}

function RemovedCard({ row }: { row: KeywordElonStep4Decision }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-black">{row.keyword}</div>
        <div className="flex flex-wrap gap-1">{row.categories.map((category) => <span key={category} className="rounded-full bg-rose-100 px-2 py-1 text-[11px] font-black text-rose-800">{CATEGORY_LABEL[category]}</span>)}</div>
      </div>
      <div className="mt-2 text-xs leading-5 text-slate-600">{row.reasons.join(" · ")}</div>
    </div>
  );
}

export default function KeywordElonStep4DualFilter() {
  const [session, setSession] = useState<ExtendedSession | null>(null);
  const [thresholds, setThresholds] = useState<KeywordElonSelectionThresholds>(() => ({ demandQuality: 60, accuracyRelevance: 90 }));
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const attemptedFingerprint = useRef("");

  useEffect(() => {
    setThresholds(readKeywordElonSelectionThresholds());
    setCustomTerms(readCustomBlockedTerms());
    let last = "";
    const sync = () => {
      const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY) || "";
      if (raw === last) return;
      last = raw;
      setSession(readSession());
    };
    sync();
    const timer = window.setInterval(sync, 500);
    const thresholdListener = () => setThresholds(readKeywordElonSelectionThresholds());
    const customListener = () => setCustomTerms(readCustomBlockedTerms());
    window.addEventListener("keyword-elon-selection-thresholds-updated", thresholdListener);
    window.addEventListener("keyword-elon-step4-custom-terms-updated", customListener);
    window.addEventListener("keyword-elon-session-updated", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keyword-elon-selection-thresholds-updated", thresholdListener);
      window.removeEventListener("keyword-elon-step4-custom-terms-updated", customListener);
      window.removeEventListener("keyword-elon-session-updated", sync);
    };
  }, []);

  const demandCandidates = useMemo(() => selectKeywordElonDemandCandidates(session?.scoredCandidates ?? [], thresholds), [session, thresholds]);
  const accuracyCandidates = useMemo(() => selectKeywordElonAccuracyCandidates(session?.scoredCandidates ?? [], thresholds), [session, thresholds]);
  const selectedCandidates = useMemo(() => selectKeywordElonStep4Union(session?.scoredCandidates ?? [], thresholds), [session, thresholds]);
  const step3Ready = Boolean(session?.stage2Status === "done" && session?.step3?.status === "done" && Number(session?.step3?.round) >= 3);
  const currentFingerprint = useMemo(() => fingerprint(selectedCandidates, thresholds, customTerms, session?.step3?.round ?? 0), [selectedCandidates, thresholds, customTerms, session?.step3?.round]);
  const currentResult = session?.step4?.status === "done" ? session.step4 : null;
  const stale = Boolean(currentResult && currentResult.inputFingerprint !== currentFingerprint);
  const candidateMap = useMemo(() => new Map(selectedCandidates.map((row) => [candidateKey(row), row] as const)), [selectedCandidates]);
  const allowedRows = useMemo(() => (currentResult?.allowedKeys ?? []).map((key) => candidateMap.get(key)).filter((row): row is KeywordElonCandidate => Boolean(row)), [currentResult, candidateMap]);
  const removedRows = useMemo(() => (currentResult?.decisions ?? []).filter((row) => row.blocked), [currentResult]);

  const runStep4 = useCallback(async () => {
    if (!session?.identity || !step3Ready || !selectedCandidates.length || busy || oneClickRunning()) return;
    setBusy(true);
    setError("");
    setMessage(`월검색 기준 ${demandCandidates.length}개 + 정확성 기준 ${accuracyCandidates.length}개를 합쳐 STEP 4 검사 중…`);
    try {
      const filtered = await requestLab<ApiRecord & { result: KeywordElonStep4FilterResult }>({
        action: "filter_prohibited_keywords",
        identity: session.identity,
        candidates: selectedCandidates,
        customBlockedTerms: customTerms,
      });
      const allowedSet = new Set(filtered.result.allowedKeys);
      const allowedCandidates = selectedCandidates.filter((row) => allowedSet.has(candidateKey(row)));
      let titleResult: KeywordElonTitleResult | null = null;
      if (allowedCandidates.length) {
        const titled = await requestLab<ApiRecord & { titleResult: KeywordElonTitleResult }>({
          action: "generate_title",
          source: session.source,
          identity: session.identity,
          candidates: allowedCandidates,
          cutoff: 0,
        });
        titleResult = titled.titleResult;
      }
      const completed: ExtendedSession = {
        ...session,
        titleResult,
        step4: {
          ...filtered.result,
          status: "done",
          inputFingerprint: currentFingerprint,
          customBlockedTerms: customTerms,
          titleResult,
          lastMessage: `STEP 4 완료 · 이중 기준 합집합 ${selectedCandidates.length}개 → 위험어 제거 후 ${filtered.result.allowedCount}개`,
          updatedAt: new Date().toISOString(),
        },
        lastMessage: `STEP 4 이중 기준 완료 · 월검색 품질 ${thresholds.demandQuality}+ / 정확성 관련성 ${thresholds.accuracyRelevance}+ · 최종 ${filtered.result.allowedCount}개`,
        updatedAt: new Date().toISOString(),
      };
      writeSession(completed);
      setSession(completed);
      setMessage(completed.lastMessage);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "STEP 4 이중 기준 검사 실패";
      setError(detail);
      setMessage("");
      const failed = readSession();
      if (failed) writeSession({ ...failed, step4: failed.step4 ? { ...failed.step4, status: "error", lastMessage: detail, updatedAt: new Date().toISOString() } : undefined, lastMessage: detail, updatedAt: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  }, [session, step3Ready, selectedCandidates, busy, demandCandidates.length, accuracyCandidates.length, customTerms, currentFingerprint, thresholds]);

  useEffect(() => {
    if (!session?.identity || !step3Ready || !selectedCandidates.length || oneClickRunning()) return;
    if (currentResult?.inputFingerprint === currentFingerprint) return;
    if (attemptedFingerprint.current === currentFingerprint) return;
    attemptedFingerprint.current = currentFingerprint;
    const timer = window.setTimeout(() => void runStep4(), 500);
    return () => window.clearTimeout(timer);
  }, [session?.identity, step3Ready, selectedCandidates.length, currentResult?.inputFingerprint, currentFingerprint, runStep4]);

  if (!session || session.stage2Status !== "done") return null;

  function addCustomTerms() {
    const additions = draft.split(/[\n,;|/]+/).map((value) => value.trim()).filter(Boolean);
    if (!additions.length) return;
    const next = uniqueKeywordElonCanonical([...customTerms, ...additions], 120).filter((term) => term.length >= 2);
    saveCustomBlockedTerms(next);
    setCustomTerms(next);
    setDraft("");
  }

  function removeCustomTerm(term: string) {
    const next = customTerms.filter((value) => value !== term);
    saveCustomBlockedTerms(next);
    setCustomTerms(next);
  }

  return (
    <section className="mx-auto mb-10 mt-[-1rem] max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-rose-200 bg-rose-50/40 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-rose-700">STEP 4 · DUAL THRESHOLD + PROHIBITED GATE</div>
            <h2 className="mt-1 text-2xl font-black">수요·정확성 합집합 → 위험·금지키워드 제거</h2>
            <p className="mt-2 text-sm text-slate-600">월검색량 TOP과 상품정확성 TOP을 서로 다른 기준으로 선별한 뒤 합집합으로 묶고, STEP 4 위험필터를 마지막으로 적용합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-900">월검색 품질 {thresholds.demandQuality}+ · {demandCandidates.length}개</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">정확성 관련성 {thresholds.accuracyRelevance}+ · {accuracyCandidates.length}개</span>
            <span className="rounded-full bg-fuchsia-100 px-3 py-1 text-fuchsia-900">중복제거 합집합 {selectedCandidates.length}개</span>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-700">KIPRIS 보류</span>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-white p-4 text-xs leading-6 text-slate-600">안전 Gate 관련성 80 / 쇼핑의도 70은 고정입니다. 상품정확성 경로는 품질점수가 낮아도 관련성 기준을 통과하면 STEP 4 재료로 들어오므로, 검색량이 작은 정확한 롱테일 키워드를 보존할 수 있습니다.</div>

        <div className="mt-4 rounded-2xl border border-violet-200 bg-white p-4">
          <div className="text-sm font-black">사용자 금지키워드</div>
          <div className="mt-3 flex flex-col gap-2 lg:flex-row"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="쉼표/줄바꿈으로 추가" className="min-h-12 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm" /><button onClick={addCustomTerms} className="rounded-xl bg-violet-700 px-5 py-3 text-sm font-black text-white">금지어 추가</button></div>
          {customTerms.length ? <div className="mt-3 flex flex-wrap gap-2">{customTerms.map((term) => <button key={term} onClick={() => removeCustomTerm(term)} className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-900">{term} ×</button>)}</div> : null}
        </div>

        {!step3Ready ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">STEP 3 자동 round 1~3 완료 후 이 기준으로 STEP 4가 자동 계산됩니다.</div> : null}
        {stale ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">점수 기준 또는 금지어가 바뀌어 STEP 4를 자동 재계산합니다.</div> : null}
        <div className="mt-4 flex flex-wrap items-center gap-3"><button disabled={!step3Ready || !selectedCandidates.length || busy || oneClickRunning()} onClick={() => { attemptedFingerprint.current = ""; void runStep4(); }} className="rounded-xl bg-rose-600 px-6 py-3 text-sm font-black text-white disabled:opacity-40">{busy ? "STEP 4 재계산 중…" : "현재 두 기준으로 STEP 4 재계산"}</button>{message ? <span className="text-sm font-bold text-slate-700">{message}</span> : null}</div>
        {error ? <div className="mt-3 rounded-xl border border-rose-300 bg-rose-100 p-4 text-sm font-bold text-rose-950">{error}</div> : null}

        {currentResult && currentResult.inputFingerprint === currentFingerprint ? (
          <div className="mt-6 space-y-5">
            <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-slate-500">STEP 4 검사 재료</div><div className="mt-1 text-2xl font-black">{currentResult.inputCount}</div></div><div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-rose-600">위험어 제거</div><div className="mt-1 text-2xl font-black text-rose-700">{currentResult.removedCount}</div></div><div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-emerald-600">최종 키워드 재료</div><div className="mt-1 text-2xl font-black text-emerald-700">{currentResult.allowedCount}</div></div></div>
            {currentResult.titleResult ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">STEP 4 FILTERED TITLE</div><div className="mt-2 text-2xl font-black text-emerald-950">{currentResult.titleResult.title}</div><div className="mt-2 text-xs text-emerald-800">사용 키워드: {currentResult.titleResult.usedKeywords.join(" / ") || "—"}</div></div> : null}
            <div className="grid gap-5 lg:grid-cols-2"><div><h3 className="mb-3 text-lg font-black text-emerald-900">통과한 최종 키워드 재료</h3><div className="space-y-2">{allowedRows.length ? allowedRows.map((row) => <KeywordCard key={candidateKey(row)} row={row} />) : <div className="rounded-xl bg-white p-4 text-sm text-slate-500">통과 키워드가 없습니다.</div>}</div></div><div><h3 className="mb-3 text-lg font-black text-rose-900">제거된 키워드와 근거</h3><div className="space-y-2">{removedRows.length ? removedRows.map((row) => <RemovedCard key={row.searchKey} row={row} />) : <div className="rounded-xl bg-white p-4 text-sm text-slate-500">제거된 키워드가 없습니다.</div>}</div></div></div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
