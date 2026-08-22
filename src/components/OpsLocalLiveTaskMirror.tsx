"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const KEYWORD_SESSION_KEY = "keywordEngineElonLab.v2.session";
const KEYWORD_AUTO_RUN_KEY = "keywordEngineElonLab.autoRunToStep4.v1";
const KEYWORD_SCORE_CACHE_PREFIX = "keywordElon.scoreBridge.";
const CHINA_LINK_AUDIT_KEY = "commerceOs.chinaLinkAudit.run.v1";
const AUDIT_HEARTBEAT_MS = 90_000;
const RECENT_RESULT_MS = 45_000;
const LOCAL_SYNC_MS = 1_000;

type Tone = "running" | "success" | "warning" | "error";

type LiveTask = {
  id: string;
  kind: "keyword" | "china_link_audit";
  title: string;
  message: string;
  detail: string;
  progress: number | null;
  progressLabel: string;
  tone: Tone;
  href: string;
  updatedAt: string;
};

type KeywordSession = {
  identity?: unknown;
  discovery?: { candidates?: unknown[] } | null;
  scoredCandidates?: unknown[];
  stage2Status?: string;
  stage2Round?: number;
  step3?: { status?: string; round?: number; lastMessage?: string } | null;
  step4?: { status?: string; lastMessage?: string } | null;
  lastMessage?: string;
  updatedAt?: string;
};

type KeywordMarker = {
  status?: string;
  requestedAt?: string;
  message?: string;
};

type ScoreCache = {
  updatedAt?: string;
  chunks?: Record<string, { candidates?: unknown[] }>;
};

type AuditRun = {
  status?: string;
  scope?: string;
  completed?: number;
  total?: number;
  permanentErrors?: number;
  temporaryErrors?: number;
  startedAt?: string;
  heartbeatAt?: string;
  finishedAt?: string;
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseStored<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function timestamp(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function newestScoreCache() {
  let selected: { key: string; cache: ScoreCache; updated: number } | null = null;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(KEYWORD_SCORE_CACHE_PREFIX)) continue;
      const cache = parseStored<ScoreCache>(key);
      if (!cache?.chunks) continue;
      const updated = timestamp(cache.updatedAt);
      if (!selected || updated >= selected.updated) selected = { key, cache, updated };
    }
  } catch {
    return null;
  }
  return selected;
}

function keywordStageMessage(session: KeywordSession | null, marker: KeywordMarker | null) {
  if (marker?.status === "armed") return "1688 원본 수집 대기";
  if (!session?.identity) return "STEP 1 상품 정체성 분석 중";
  if (!session.discovery?.candidates?.length) return "STEP 2 시장어 발굴 중";
  if (session.stage2Status === "scoring") return "STEP 2 AI 품질점수 계산 중";
  const round = number(session.step3?.round);
  if (round < 3) return `STEP 3 round ${Math.min(3, round + 1)}/3 자동 확장 중`;
  if (session.step4?.status !== "done") return "STEP 4 위험어 필터·최종 상품명 생성 중";
  return text(session.lastMessage) || "FINAL RESULT 생성 완료";
}

function readKeywordTask(now: number): LiveTask | null {
  const session = parseStored<KeywordSession>(KEYWORD_SESSION_KEY);
  const marker = parseStored<KeywordMarker>(KEYWORD_AUTO_RUN_KEY);
  const score = newestScoreCache();
  const markerActive = marker?.status === "armed" || marker?.status === "running";
  const stageActive = session?.stage2Status === "scoring";

  if (score && (markerActive || stageActive)) {
    const totalCandidates = session?.discovery?.candidates?.length ?? 0;
    const totalChunks = totalCandidates ? Math.ceil(totalCandidates / 12) : 0;
    const doneChunks = Object.keys(score.cache.chunks ?? {}).length;
    const scored = Object.values(score.cache.chunks ?? {}).reduce(
      (sum, chunk) => sum + (Array.isArray(chunk.candidates) ? chunk.candidates.length : 0),
      0,
    );
    const processingChunk = totalChunks
      ? Math.min(totalChunks, Math.max(1, doneChunks + 1))
      : doneChunks + 1;
    const enrichment = Boolean(totalChunks && doneChunks >= totalChunks);
    return {
      id: "keyword-score",
      kind: "keyword",
      title: "SEO 대량등록 클라우드",
      message: enrichment
        ? "AI 점수화 완료 · 월검색 미측정 후보 보강 중"
        : `AI 점수화 ${processingChunk}/${totalChunks || "?"} · 최대 12개 처리 중`,
      detail: totalCandidates
        ? `${scored}/${totalCandidates}개 점수 저장 · 작업 원본 탭은 닫지 마세요.`
        : `${scored}개 점수 저장 · 작업 원본 탭은 닫지 마세요.`,
      progress:
        totalChunks > 0
          ? clampProgress((Math.min(doneChunks, totalChunks) / totalChunks) * 100)
          : null,
      progressLabel: totalChunks
        ? `${doneChunks}/${totalChunks} 기본 묶음 · ${scored}개 저장`
        : `${scored}개 저장`,
      tone: "running",
      href: "/keyword-engine-elon-lab",
      updatedAt: score.cache.updatedAt || session?.updatedAt || marker?.requestedAt || "",
    };
  }

  if (markerActive) {
    const message = keywordStageMessage(session, marker);
    let progress = 8;
    if (session?.identity) progress = 20;
    if (session?.discovery?.candidates?.length) progress = 35;
    if (session?.stage2Status === "done") progress = 50;
    const round = number(session?.step3?.round);
    if (round > 0) progress = 50 + Math.min(3, round) * 12;
    if (round >= 3) progress = 88;
    return {
      id: "keyword-pipeline",
      kind: "keyword",
      title: "SEO 대량등록 클라우드",
      message,
      detail: text(session?.lastMessage || marker?.message) || "STEP 1~4 자동 실행 중",
      progress,
      progressLabel: `STEP 1~4 진행 · ${progress}%`,
      tone: "running",
      href: "/keyword-engine-elon-lab",
      updatedAt: session?.updatedAt || marker?.requestedAt || "",
    };
  }

  if (marker?.status === "error") {
    const updated = timestamp(session?.updatedAt || marker.requestedAt);
    if (updated && now - updated <= RECENT_RESULT_MS) {
      return {
        id: "keyword-error",
        kind: "keyword",
        title: "SEO 대량등록 클라우드",
        message: "작업 확인 필요",
        detail: text(marker.message || session?.lastMessage) || "키워드 작업이 중단됐습니다.",
        progress: null,
        progressLabel: "실패 지점 확인 필요",
        tone: "error",
        href: "/keyword-engine-elon-lab",
        updatedAt: session?.updatedAt || marker.requestedAt || "",
      };
    }
  }

  const completedAt = timestamp(session?.updatedAt);
  if (
    session?.step4?.status === "done" &&
    completedAt &&
    now - completedAt <= RECENT_RESULT_MS
  ) {
    return {
      id: "keyword-complete",
      kind: "keyword",
      title: "SEO 대량등록 클라우드",
      message: "FINAL RESULT 생성 완료",
      detail: text(session.lastMessage) || text(session.step4.lastMessage) || "STEP 1~4 완료",
      progress: 100,
      progressLabel: "완료",
      tone: "success",
      href: "/keyword-engine-elon-lab",
      updatedAt: session.updatedAt || "",
    };
  }

  return null;
}

function readAuditTask(now: number): LiveTask | null {
  const run = parseStored<AuditRun>(CHINA_LINK_AUDIT_KEY);
  if (!run?.status) return null;
  const total = number(run.total);
  const completed = number(run.completed);
  const heartbeat = timestamp(run.heartbeatAt || run.startedAt);
  const active = run.status === "running" && heartbeat > 0 && now - heartbeat <= AUDIT_HEARTBEAT_MS;
  const scopeLabel = run.scope === "all" ? "고정링크 전체재검사" : "고정링크 저속 검사";

  if (active) {
    return {
      id: "china-link-audit",
      kind: "china_link_audit",
      title: scopeLabel,
      message: `${completed.toLocaleString()}/${total ? total.toLocaleString() : "?"} 검사 중`,
      detail: `확정 오류 ${number(run.permanentErrors).toLocaleString()} · 일시 오류 ${number(
        run.temporaryErrors,
      ).toLocaleString()} · 작은 검사창을 유지하세요.`,
      progress: total > 0 ? clampProgress((completed / total) * 100) : null,
      progressLabel: total ? `${completed}/${total}` : `${completed}건 완료`,
      tone: "running",
      href: "/product-launch-tracker",
      updatedAt: run.heartbeatAt || run.startedAt || "",
    };
  }

  const finishedAt = timestamp(run.finishedAt || run.heartbeatAt);
  if (!finishedAt || now - finishedAt > RECENT_RESULT_MS) return null;

  if (run.status === "completed") {
    return {
      id: "china-link-audit-complete",
      kind: "china_link_audit",
      title: scopeLabel,
      message: "검사 완료",
      detail: `${completed}/${total || completed} · 확정 오류 ${number(
        run.permanentErrors,
      )} · 일시 오류 ${number(run.temporaryErrors)}`,
      progress: 100,
      progressLabel: "완료",
      tone: "success",
      href: "/product-launch-tracker",
      updatedAt: run.finishedAt || "",
    };
  }

  if (run.status === "cancelled" || run.status === "interrupted") {
    return {
      id: "china-link-audit-stopped",
      kind: "china_link_audit",
      title: scopeLabel,
      message: run.status === "cancelled" ? "검사 중단" : "화면 이동으로 검사 중단",
      detail: `${completed}/${total || "?"}까지 저장됨`,
      progress: total > 0 ? clampProgress((completed / total) * 100) : null,
      progressLabel: total ? `${completed}/${total}` : `${completed}건 저장`,
      tone: "warning",
      href: "/product-launch-tracker",
      updatedAt: run.finishedAt || "",
    };
  }

  return null;
}

function toneStyle(tone: Tone) {
  if (tone === "success") {
    return {
      border: "border-emerald-300",
      badge: "bg-emerald-100 text-emerald-800",
      bar: "bg-emerald-600",
    };
  }
  if (tone === "warning") {
    return {
      border: "border-amber-300",
      badge: "bg-amber-100 text-amber-900",
      bar: "bg-amber-500",
    };
  }
  if (tone === "error") {
    return {
      border: "border-rose-300",
      badge: "bg-rose-100 text-rose-800",
      bar: "bg-rose-600",
    };
  }
  return {
    border: "border-violet-300",
    badge: "bg-violet-100 text-violet-800",
    bar: "bg-violet-600",
  };
}

export function OpsLocalLiveTaskMirror() {
  const pathname = usePathname();
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;

    const sync = () => {
      if (stopped) return;
      if (timer !== null) window.clearTimeout(timer);
      const now = Date.now();
      const next = [readKeywordTask(now), readAuditTask(now)].filter(
        (task): task is LiveTask => Boolean(task),
      );
      setTasks(next);
      timer = window.setTimeout(sync, LOCAL_SYNC_MS);
    };

    const onStorage = (event: StorageEvent) => {
      if (
        event.key === KEYWORD_SESSION_KEY ||
        event.key === KEYWORD_AUTO_RUN_KEY ||
        event.key === CHINA_LINK_AUDIT_KEY ||
        event.key?.startsWith(KEYWORD_SCORE_CACHE_PREFIX)
      ) {
        sync();
      }
    };
    const onKeywordUpdate = () => sync();
    const onFocus = () => sync();

    timer = window.setTimeout(sync, 0);
    window.addEventListener("storage", onStorage);
    window.addEventListener("keyword-elon-session-updated", onKeywordUpdate);
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("keyword-elon-session-updated", onKeywordUpdate);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        // Keyword Lab already renders its richer adaptive scoring card on its own page.
        if (task.kind === "keyword" && pathname.startsWith("/keyword-engine-elon-lab")) {
          return false;
        }
        return true;
      }),
    [pathname, tasks],
  );

  if (!visibleTasks.length) return null;

  return (
    <aside
      aria-label="OPS 브라우저 실시간 작업"
      className="print:hidden fixed bottom-5 left-4 z-[74] w-[min(390px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-2xl sm:left-6"
    >
      <header className="flex items-center justify-between gap-3 bg-slate-950 px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-300">
            OPS CENTER · LIVE TASK
          </div>
          <h2 className="mt-0.5 truncate text-sm font-black">
            현재 브라우저 작업 {visibleTasks.length}건
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-base font-black hover:bg-slate-600"
          aria-label={collapsed ? "실시간 작업 펼치기" : "실시간 작업 접기"}
        >
          {collapsed ? "+" : "−"}
        </button>
      </header>

      {!collapsed ? (
        <div className="space-y-2 bg-slate-50 p-2.5">
          {visibleTasks.map((task) => {
            const style = toneStyle(task.tone);
            const badge =
              task.tone === "running"
                ? "진행 중"
                : task.tone === "success"
                  ? "완료"
                  : task.tone === "warning"
                    ? "확인 필요"
                    : "오류";
            return (
              <article
                key={task.id}
                className={`rounded-xl border ${style.border} bg-white p-3 shadow-sm`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black">{task.title}</h3>
                    <p className="mt-1 text-xs font-bold text-slate-700">{task.message}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${style.badge}`}>
                    {badge}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] font-semibold leading-5 text-slate-500">
                  {task.detail}
                </p>
                {task.progress !== null ? (
                  <div className="mt-2.5">
                    <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-black text-slate-500">
                      <span>{task.progressLabel}</span>
                      <span>{task.progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${style.bar}`}
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="mt-2.5 flex justify-end border-t border-slate-100 pt-2">
                  <Link
                    href={task.href}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-100"
                  >
                    작업 화면 열기
                  </Link>
                </div>
              </article>
            );
          })}
          <p className="px-1 text-[10px] font-bold text-slate-400">
            상태 확인은 브라우저 로컬 데이터만 사용합니다. 작업 원본 탭은 완료 전까지 닫지 마세요.
          </p>
        </div>
      ) : null}
    </aside>
  );
}
