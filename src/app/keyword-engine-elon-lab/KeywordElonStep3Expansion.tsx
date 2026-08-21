"use client";

import { useEffect, useMemo, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonLabSession,
  type KeywordElonTitleResult,
} from "@/lib/keywordEngineElonLabV2";
import {
  mergeKeywordElonCandidates,
  mergeKeywordElonDiscovery,
} from "@/lib/keywordEngineElonLabV2Merge";

type ApiRecord = Record<string, unknown> & { ok?: boolean; error?: unknown; errorStage?: unknown };
type Step3Status = "idle" | "discovering" | "scoring" | "title" | "done" | "error";
type Step3Meta = {
  status: Step3Status;
  round: number;
  seedKeywords: string[];
  newCandidateCount: number;
  newPassingCount: number;
  totalPassingCount: number;
  lastMessage: string;
  updatedAt: string;
};
type ExtendedSession = KeywordElonLabSession & { step3?: Step3Meta };

type ExpansionResponse = ApiRecord & {
  discovery: KeywordElonDiscovery;
  seedKeywords: string[];
  round: number;
  newCandidateCount: number;
  apiHubEvidenceCount: number;
  searchAdCandidateCount: number;
  warnings?: string[];
};

type ScoreResponse = ApiRecord & {
  candidates: KeywordElonCandidate[];
  scoringWarnings?: string[];
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

function nextMeta(previous: Step3Meta | undefined, patch: Partial<Step3Meta>): Step3Meta {
  return {
    status: previous?.status ?? "idle",
    round: previous?.round ?? 0,
    seedKeywords: previous?.seedKeywords ?? [],
    newCandidateCount: previous?.newCandidateCount ?? 0,
    newPassingCount: previous?.newPassingCount ?? 0,
    totalPassingCount: previous?.totalPassingCount ?? 0,
    lastMessage: previous?.lastMessage ?? "",
    updatedAt: new Date().toISOString(),
    ...patch,
  };
}

function passingRows(session: ExtendedSession) {
  return (session.scoredCandidates ?? [])
    .filter((row) => row.safetyPass && row.qualityScore >= session.cutoff)
    .sort((a, b) => b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
}

function seedRows(session: ExtendedSession) {
  return uniqueKeywordElonCanonical(
    passingRows(session).map((row) => row.searchKeyword || row.searchKey || row.keyword),
    8,
  );
}

export default function KeywordElonStep3Expansion() {
  const [session, setSession] = useState<ExtendedSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
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
      window.clearInterval(timer);
      window.removeEventListener("keyword-elon-session-updated", listener);
    };
  }, []);

  const passing = useMemo(() => session ? passingRows(session) : [], [session]);
  const seeds = useMemo(() => session ? seedRows(session) : [], [session]);

  if (!session || session.stage2Status !== "done" || !session.identity || !session.discovery) return null;

  async function runSingleRound(base: ExtendedSession, round: number, makeTitle: boolean) {
    if (!base.identity || !base.discovery) throw new Error("STEP 3 실행에 필요한 세션이 없습니다.");
    const source = base.source;
    const identity = base.identity;
    const cutoff = base.cutoff;
    const roundPassing = passingRows(base);
    const roundSeeds = seedRows(base);
    if (!roundSeeds.length) throw new Error("STEP 3에서 사용할 통과 Seed가 없습니다.");

    setMessage(`STEP 3 round ${round} · Seed ${roundSeeds.join(" / ")}에서 신규 시장어 발굴 중…`);
    const started: ExtendedSession = {
      ...base,
      step3: nextMeta(base.step3, {
        status: "discovering",
        round,
        seedKeywords: roundSeeds,
        lastMessage: `round ${round} · 통과키워드 ${roundSeeds.length}개로 추가발굴 중`,
      }),
      updatedAt: new Date().toISOString(),
    };
    writeSession(started);
    setSession(started);

    const expanded = await requestLab<ExpansionResponse>({
      action: "expand_from_passing",
      identity,
      seedKeywords: roundSeeds,
      existingDiscovery: base.discovery,
      existingCandidates: base.scoredCandidates,
      round,
    });

    if (!expanded.newCandidateCount || !expanded.discovery.candidates.length) {
      const noNew: ExtendedSession = {
        ...base,
        step3: nextMeta(base.step3, {
          status: "done",
          round,
          seedKeywords: expanded.seedKeywords?.length ? expanded.seedKeywords : roundSeeds,
          newCandidateCount: 0,
          newPassingCount: 0,
          totalPassingCount: roundPassing.length,
          lastMessage: `round ${round} 완료 · 기존 후보를 제외한 신규 키워드 없음`,
        }),
        lastMessage: `STEP 3 round ${round} 완료 · 신규 후보 없음 · 전체 통과 ${roundPassing.length}개`,
        updatedAt: new Date().toISOString(),
      };
      writeSession(noNew);
      setSession(noNew);
      return noNew;
    }

    setMessage(`STEP 3 round ${round} · 신규 후보 ${expanded.newCandidateCount}개 · AI 안전 Gate와 수요점수 계산 중…`);
    const scoringSession: ExtendedSession = {
      ...started,
      step3: nextMeta(started.step3, {
        status: "scoring",
        newCandidateCount: expanded.newCandidateCount,
        lastMessage: `round ${round} · 신규 후보 ${expanded.newCandidateCount}개 점수화 중`,
      }),
    };
    writeSession(scoringSession);
    setSession(scoringSession);

    const scored = await requestLab<ScoreResponse>({
      action: "score_keywords",
      source,
      identity,
      discovery: expanded.discovery,
    });
    const mergedCandidates = mergeKeywordElonCandidates(base.scoredCandidates, scored.candidates);
    const mergedDiscovery = mergeKeywordElonDiscovery(base.discovery, expanded.discovery);
    const previousKeys = new Set(base.scoredCandidates.map((row) => compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)));
    const newlyPassed = scored.candidates.filter(
      (row) => row.safetyPass && row.qualityScore >= cutoff && !previousKeys.has(compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)),
    );
    const totalPassing = mergedCandidates.filter((row) => row.safetyPass && row.qualityScore >= cutoff).length;

    let titleResult = base.titleResult;
    if (makeTitle) {
      setMessage(`STEP 3 round ${round} · 신규 통과 ${newlyPassed.length}개 · 전체 ${totalPassing}개 · 최종 상품명 재조립 중…`);
      const titleResponse = await requestLab<ApiRecord & { titleResult: KeywordElonTitleResult }>({
        action: "generate_title",
        source,
        identity,
        candidates: mergedCandidates,
        cutoff,
      });
      titleResult = titleResponse.titleResult;
    }

    const completed: ExtendedSession = {
      ...base,
      discovery: mergedDiscovery,
      scoredCandidates: mergedCandidates,
      titleResult,
      stage2Status: "done",
      step3: nextMeta(base.step3, {
        status: "done",
        round,
        seedKeywords: expanded.seedKeywords,
        newCandidateCount: expanded.newCandidateCount,
        newPassingCount: newlyPassed.length,
        totalPassingCount: totalPassing,
        lastMessage: `round ${round} 완료 · 신규 후보 ${expanded.newCandidateCount}개 · 신규 통과 ${newlyPassed.length}개`,
      }),
      lastMessage: `STEP 3 round ${round} 완료 · 신규 통과 ${newlyPassed.length}개 · 전체 ${cutoff}점 이상 ${totalPassing}개`,
      updatedAt: new Date().toISOString(),
    };
    writeSession(completed);
    setSession(completed);
    return completed;
  }

  async function runStep3() {
    if (!session || !session.identity || !session.discovery || !seeds.length || busy) return;
    const currentRound = session.step3?.round ?? 0;
    const targetRound = currentRound < 3 ? 3 : currentRound + 1;
    setBusy(true);
    setError("");
    try {
      let working = session;
      for (let round = currentRound + 1; round <= targetRound; round += 1) {
        const automatic = targetRound === 3;
        setMessage(
          automatic
            ? `STEP 3 자동 확장 · round ${round}/3 실행 중…`
            : `STEP 3 추가발굴 · round ${round} 실행 중…`,
        );
        working = await runSingleRound(working, round, round === targetRound);
      }
      const doneMessage = targetRound === 3
        ? `STEP 3 자동 확장 round 1~3 완료 · 전체 통과 ${working.step3?.totalPassingCount ?? passingRows(working).length}개`
        : `STEP 3 round ${targetRound} 추가발굴 완료 · 전체 통과 ${working.step3?.totalPassingCount ?? passingRows(working).length}개`;
      const finalSession: ExtendedSession = {
        ...working,
        lastMessage: doneMessage,
        updatedAt: new Date().toISOString(),
      };
      writeSession(finalSession);
      setSession(finalSession);
      setMessage(doneMessage);
      window.setTimeout(() => window.location.reload(), 450);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "STEP 3 추가발굴 실패";
      const failed: ExtendedSession = {
        ...session,
        step3: nextMeta(session.step3, {
          status: "error",
          lastMessage: detail,
        }),
        lastMessage: detail,
        updatedAt: new Date().toISOString(),
      };
      writeSession(failed);
      setSession(failed);
      setError(detail);
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  const currentRound = session.step3?.round ?? 0;
  const buttonLabel = currentRound < 3
    ? `STEP 3 · 자동 추가발굴 round ${currentRound + 1}→3`
    : `STEP 3 · 추가발굴 round ${currentRound + 1}`;

  return (
    <section className="mx-auto mb-8 max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-fuchsia-200 bg-fuchsia-50/50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-700">STEP 3 · PASSING KEYWORD EXPANSION</div>
            <h2 className="mt-1 text-2xl font-black">통과키워드에서 추가 시장어 발굴</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              첫 실행은 round 1→2→3을 한 번에 자동 진행합니다. 각 round에서 살아남은 키워드는 누적 보존되고 다음 round의 Seed 후보가 됩니다. round 3 이후에는 필요할 때 한 round씩 더 확장할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-white px-3 py-1 text-fuchsia-900 ring-1 ring-fuchsia-200">현재 통과 {passing.length}개</span>
            <span className="rounded-full bg-white px-3 py-1 text-fuchsia-900 ring-1 ring-fuchsia-200">Seed {seeds.length}개</span>
            <span className="rounded-full bg-white px-3 py-1 text-fuchsia-900 ring-1 ring-fuchsia-200">완료 round {currentRound}</span>
            <span className="rounded-full bg-fuchsia-100 px-3 py-1 text-fuchsia-900">기본 자동 round 3</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {seeds.map((seed) => (
            <span key={seed} className="rounded-full bg-white px-3 py-1 text-sm font-black text-slate-800 ring-1 ring-slate-200">{seed}</span>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !seeds.length}
            onClick={runStep3}
            className="rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40"
          >
            {busy ? "STEP 3 자동 확장 실행 중…" : buttonLabel}
          </button>
          <span className="text-sm text-slate-500">한 round당 Seed 최대 8개 · 신규 후보 최대 300개 · 기존 후보 자동 제외</span>
        </div>

        {message ? <div className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-bold text-fuchsia-950 ring-1 ring-fuchsia-100">{message}</div> : null}
        {error ? <div className="mt-4 whitespace-pre-wrap rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-mono text-xs leading-6 text-rose-900">{error}</div> : null}
        {session.step3?.status === "done" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-slate-500">최근 round 신규 후보</div><div className="mt-1 text-2xl font-black">{session.step3.newCandidateCount}</div></div>
            <div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-slate-500">최근 round 신규 통과</div><div className="mt-1 text-2xl font-black text-emerald-700">{session.step3.newPassingCount}</div></div>
            <div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-slate-500">누적 전체 통과</div><div className="mt-1 text-2xl font-black">{session.step3.totalPassingCount}</div></div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
