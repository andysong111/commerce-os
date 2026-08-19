"use client";

import { useEffect, useMemo, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonLabSession,
  type KeywordElonTitleResult,
} from "@/lib/keywordEngineElonLabV2";
import type {
  KeywordElonStep4Decision,
  KeywordElonStep4FilterResult,
  KeywordElonStep4RiskCategory,
} from "@/lib/keywordEngineElonLabV2Step4";

const CUSTOM_BLOCKED_STORAGE_KEY = "keywordEngineElonLab.step4.customBlockedTerms.v1";

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
    if (!raw) return null;
    return JSON.parse(raw) as ExtendedSession;
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
}

function candidateKeyword(row: KeywordElonCandidate) {
  return row.searchKeyword || row.searchKey || compactKeywordElonKey(row.keyword);
}

function buildFingerprint(
  candidates: KeywordElonCandidate[],
  cutoff: number,
  round: number,
  customBlockedTerms: string[],
) {
  return [
    `round:${round}`,
    `cutoff:${cutoff}`,
    `custom:${customBlockedTerms.join(",")}`,
    ...candidates.map((row) => `${compactKeywordElonKey(candidateKeyword(row))}:${row.qualityScore.toFixed(2)}:${Number(row.titleEligible)}`),
  ].join("|");
}

function CategoryChips({ categories }: { categories: KeywordElonStep4RiskCategory[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {categories.map((category) => (
        <span key={category} className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-black text-rose-800">
          {CATEGORY_LABEL[category]}
        </span>
      ))}
    </div>
  );
}

function CandidateRow({ row }: { row: KeywordElonCandidate }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="font-black text-slate-900">{candidateKeyword(row)}</div>
        <div className="mt-1 text-xs text-slate-500">
          관련성 {row.relevance.toFixed(0)} · 쇼핑의도 {row.shoppingIntent.toFixed(0)} · 최종 {row.qualityScore.toFixed(1)}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-black tabular-nums">{row.totalSearch === null ? "—" : row.totalSearch.toLocaleString()}</div>
        <div className="text-[11px] text-slate-400">월검색</div>
      </div>
    </div>
  );
}

function RemovedRow({ decision }: { decision: KeywordElonStep4Decision }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="font-black text-slate-900">{decision.keyword}</div>
        <CategoryChips categories={decision.categories} />
      </div>
      <div className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
        {decision.reasons.map((reason) => <div key={reason}>· {reason}</div>)}
      </div>
    </div>
  );
}

export default function KeywordElonStep4Filter() {
  const [session, setSession] = useState<ExtendedSession | null>(null);
  const [customBlockedTerms, setCustomBlockedTerms] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const customTermsTimer = window.setTimeout(() => {
      setCustomBlockedTerms(readCustomBlockedTerms());
    }, 0);
    let last = "";
    const sync = () => {
      const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY) || "";
      if (raw === last) return;
      last = raw;
      setSession(readSession());
    };
    sync();
    const timer = window.setInterval(sync, 700);
    const listener = () => sync();
    window.addEventListener("keyword-elon-session-updated", listener);
    return () => {
      window.clearTimeout(customTermsTimer);
      window.clearInterval(timer);
      window.removeEventListener("keyword-elon-session-updated", listener);
    };
  }, []);

  const inputCandidates = useMemo(
    () => (session?.scoredCandidates ?? [])
      .filter((row) => row.safetyPass && row.qualityScore >= (session?.cutoff ?? 70))
      .sort((a, b) => b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1)),
    [session],
  );
  const step3Ready = Boolean(
    session?.stage2Status === "done"
    && session?.step3?.status === "done"
    && Number(session?.step3?.round) >= 1,
  );
  const fingerprint = useMemo(
    () => buildFingerprint(inputCandidates, session?.cutoff ?? 70, session?.step3?.round ?? 0, customBlockedTerms),
    [inputCandidates, session?.cutoff, session?.step3?.round, customBlockedTerms],
  );
  const currentResult = session?.step4?.status === "done" ? session.step4 : null;
  const resultStale = Boolean(currentResult && currentResult.inputFingerprint !== fingerprint);
  const candidateByKey = useMemo(
    () => new Map(inputCandidates.map((row) => [compactKeywordElonKey(candidateKeyword(row)), row] as const)),
    [inputCandidates],
  );
  const allowedRows = useMemo(
    () => (currentResult?.allowedKeys ?? []).map((key) => candidateByKey.get(key)).filter((row): row is KeywordElonCandidate => Boolean(row)),
    [currentResult, candidateByKey],
  );
  const removedDecisions = useMemo(
    () => (currentResult?.decisions ?? []).filter((decision) => decision.blocked),
    [currentResult],
  );

  if (!session || session.stage2Status !== "done") return null;

  function commitCustomTerms(next: string[]) {
    const normalized = uniqueKeywordElonCanonical(next, 120).filter((term) => term.length >= 2);
    setCustomBlockedTerms(normalized);
    saveCustomBlockedTerms(normalized);
  }

  function addCustomTerms() {
    const additions = draft.split(/[\n,;|/]+/).map((value) => value.trim()).filter(Boolean);
    if (!additions.length) return;
    commitCustomTerms([...customBlockedTerms, ...additions]);
    setDraft("");
    setMessage("사용자 금지어를 저장했습니다. STEP 4를 다시 실행하면 반영됩니다.");
  }

  function removeCustomTerm(term: string) {
    commitCustomTerms(customBlockedTerms.filter((value) => value !== term));
    setMessage("사용자 금지어를 삭제했습니다. STEP 4를 다시 실행하면 반영됩니다.");
  }

  async function runStep4() {
    if (!session?.identity || !step3Ready || !inputCandidates.length || busy) return;
    setBusy(true);
    setError("");
    setMessage(`최종 재료 ${inputCandidates.length}개에서 위험 키워드를 검사하고 있습니다…`);
    const started: ExtendedSession = {
      ...session,
      step4: {
        status: "running",
        inputFingerprint: fingerprint,
        customBlockedTerms,
        titleResult: null,
        inputCount: inputCandidates.length,
        allowedCount: 0,
        removedCount: 0,
        allowedKeys: [],
        removedKeys: [],
        decisions: [],
        aiConfigured: false,
        kiprisConfigured: false,
        kiprisCheckedCount: 0,
        kiprisMatchedCount: 0,
        warnings: [],
        lastMessage: "STEP 4 위험 키워드 검사 중",
        updatedAt: new Date().toISOString(),
      },
      lastMessage: "STEP 4 · 금지키워드 제거 중",
      updatedAt: new Date().toISOString(),
    };
    writeSession(started);
    setSession(started);

    try {
      const filtered = await requestLab<ApiRecord & { result: KeywordElonStep4FilterResult }>({
        action: "filter_prohibited_keywords",
        identity: session.identity,
        candidates: inputCandidates,
        customBlockedTerms,
      });
      const allowedSet = new Set(filtered.result.allowedKeys);
      const filteredCandidates = inputCandidates.filter((row) => allowedSet.has(compactKeywordElonKey(candidateKeyword(row))));
      let titleResult: KeywordElonTitleResult | null = null;
      if (filteredCandidates.length) {
        const titled = await requestLab<ApiRecord & { titleResult: KeywordElonTitleResult }>({
          action: "generate_title",
          source: session.source,
          identity: session.identity,
          candidates: filteredCandidates,
          cutoff: session.cutoff,
        });
        titleResult = titled.titleResult;
      }

      const completed: ExtendedSession = {
        ...session,
        titleResult,
        step4: {
          ...filtered.result,
          status: "done",
          inputFingerprint: fingerprint,
          customBlockedTerms,
          titleResult,
          lastMessage: filtered.result.allowedCount
            ? `STEP 4 완료 · ${filtered.result.removedCount}개 제거 · 최종 재료 ${filtered.result.allowedCount}개`
            : "STEP 4 완료 · 최종 사용 가능한 키워드가 없어 수동 검토가 필요합니다.",
          updatedAt: new Date().toISOString(),
        },
        lastMessage: filtered.result.allowedCount
          ? `STEP 4 완료 · 위험 키워드 ${filtered.result.removedCount}개 제거 · 최종 ${filtered.result.allowedCount}개`
          : "STEP 4 완료 · 모든 최종 재료가 제거되어 상품명 생성을 중지했습니다.",
        updatedAt: new Date().toISOString(),
      };
      writeSession(completed);
      setSession(completed);
      setMessage(completed.lastMessage);
      window.setTimeout(() => window.location.reload(), 350);
    } catch (runError) {
      const text = runError instanceof Error ? runError.message : "STEP 4 금지키워드 검사 실패";
      const failed: ExtendedSession = {
        ...session,
        step4: {
          ...(started.step4 as Step4Meta),
          status: "error",
          lastMessage: text,
          updatedAt: new Date().toISOString(),
        },
        lastMessage: text,
        updatedAt: new Date().toISOString(),
      };
      writeSession(failed);
      setSession(failed);
      setError(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto mb-10 mt-[-1rem] max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-rose-200 bg-rose-50/40 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-rose-700">STEP 4 · PROHIBITED KEYWORD GATE</div>
            <h2 className="mt-1 text-2xl font-black">최종 재료에서 위험·금지키워드 제거</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              STEP 3까지 살아남은 키워드에서 의료기기, 임산부, 유아용품, 성인용품 위험어와 사용자가 직접 추가한 금지어를 제거한 뒤 상품명을 다시 조립합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">입력 {inputCandidates.length}개</span>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-700">KIPRIS 상표권 · 보류</span>
            <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-800">기본 위험영역 4종</span>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-800">사용자 금지어 {customBlockedTerms.length}개</span>
          </div>
        </div>

        {!step3Ready ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-bold text-amber-900">
            STEP 3를 최소 1회 완료해야 STEP 4가 열립니다. STEP 3의 최신 round가 끝난 뒤 실행하세요.
          </div>
        ) : null}

        <div className="mt-5 rounded-2xl border border-violet-200 bg-white p-4">
          <div className="text-sm font-black">사용자 금지키워드 추가</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">쉼표 또는 줄바꿈으로 여러 개를 입력할 수 있습니다. 이 목록은 새 상품 실험에서도 계속 유지됩니다.</p>
          <div className="mt-3 flex flex-col gap-2 lg:flex-row">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="예: 특정브랜드, 과장효능어, 사용하지 않을 표현"
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
            <button onClick={addCustomTerms} className="rounded-xl bg-violet-700 px-5 py-3 text-sm font-black text-white">금지어 추가</button>
          </div>
          {customBlockedTerms.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {customBlockedTerms.map((term) => (
                <button key={term} onClick={() => removeCustomTerm(term)} className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-900">
                  {term} ×
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-5 rounded-xl bg-white p-4 text-xs leading-6 text-slate-600">
          현재 자동 차단 대상은 의료기기·치료/진단, 임산부·임신/출산, 유아·영아/아동용품, 성인용품·성적 용도와 사용자 금지어입니다. KIPRIS 상표권 API 연결은 이번 버전에서 보류하며 호출하지 않습니다.
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            disabled={!step3Ready || !inputCandidates.length || busy}
            onClick={runStep4}
            className="rounded-xl bg-rose-600 px-6 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "STEP 4 검사 중…" : "STEP 4 · 금지키워드 제거 실행"}
          </button>
          {message ? <span className="text-sm font-bold text-slate-700">{message}</span> : null}
        </div>
        {error ? <div className="mt-3 rounded-xl border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-bold text-rose-950">{error}</div> : null}

        {currentResult ? (
          <div className="mt-6 space-y-5">
            {resultStale ? (
              <div className="rounded-xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-black text-amber-950">
                STEP 3 결과, 커트라인 또는 사용자 금지어가 바뀌었습니다. 아래 결과는 이전 검사이며 STEP 4 재실행이 필요합니다.
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-slate-500">검사 재료</div><div className="mt-1 text-2xl font-black">{currentResult.inputCount}</div></div>
              <div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-rose-600">자동 제거</div><div className="mt-1 text-2xl font-black text-rose-700">{currentResult.removedCount}</div></div>
              <div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-emerald-600">최종 재료</div><div className="mt-1 text-2xl font-black text-emerald-700">{currentResult.allowedCount}</div></div>
              <div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-violet-600">사용자 금지어</div><div className="mt-1 text-2xl font-black text-violet-700">{customBlockedTerms.length}</div></div>
            </div>

            {currentResult.titleResult ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">STEP 4 FILTERED TITLE</div>
                <div className="mt-2 text-2xl font-black text-emerald-950">{currentResult.titleResult.title}</div>
                <div className="mt-2 text-xs text-emerald-800">사용 키워드: {currentResult.titleResult.usedKeywords.join(" / ") || "—"}</div>
              </div>
            ) : (
              <div className="rounded-2xl border border-rose-300 bg-rose-100 p-5 text-sm font-black text-rose-950">
                최종 사용 가능한 키워드가 없어 상품명 생성을 중지했습니다. 이 상품은 수동 검토 대상으로 보내야 합니다.
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-3 text-lg font-black text-emerald-900">통과한 최종 키워드 재료</h3>
                <div className="space-y-2">
                  {allowedRows.length ? allowedRows.map((row) => <CandidateRow key={compactKeywordElonKey(candidateKeyword(row))} row={row} />) : <div className="rounded-xl bg-white p-4 text-sm text-slate-500">통과 키워드가 없습니다.</div>}
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-lg font-black text-rose-900">제거된 키워드와 근거</h3>
                <div className="space-y-2">
                  {removedDecisions.length ? removedDecisions.map((decision) => <RemovedRow key={decision.searchKey} decision={decision} />) : <div className="rounded-xl bg-white p-4 text-sm text-slate-500">제거된 키워드가 없습니다.</div>}
                </div>
              </div>
            </div>

            {currentResult.warnings.length ? (
              <details className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
                <summary className="cursor-pointer font-black">검사 경고 {currentResult.warnings.length}건</summary>
                <div className="mt-2 space-y-1">{currentResult.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
