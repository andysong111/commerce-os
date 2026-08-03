"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "shoplingPriceModifySimpleAutoJobId";

type Health = {
  code?: string;
  severity?: "ok" | "warning" | "error";
  label?: string;
  message?: string;
  recommended_action?: string;
  active_chunk_age_seconds?: number | null;
  automation_last_tick_age_seconds?: number | null;
};

type Diagnostic = {
  captured_at?: string;
  page_origin?: string;
  job?: Record<string, unknown>;
  health?: Health;
  progress?: Record<string, unknown>;
  current_active_chunk?: Record<string, unknown> | null;
  recent_chunks?: Array<Record<string, unknown>>;
};

function text(value: unknown) {
  return typeof value === "string" && value ? value : "-";
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function duration(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "확인 불가";
  if (seconds < 60) return `${Math.floor(seconds)}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

function localTime(value: unknown) {
  if (typeof value !== "string" || !value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ko-KR") : value;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

export function ShoplingPriceModifyJobDiagnostics() {
  const [jobId, setJobId] = useState("");
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState("");
  const [changed, setChanged] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const requestInFlight = useRef(false);
  const diagnosticRef = useRef<Diagnostic | null>(null);

  useEffect(() => {
    const detect = () => {
      const queryId = new URLSearchParams(window.location.search).get("bulkJobId") ?? "";
      const storedId = localStorage.getItem(STORAGE_KEY) ?? "";
      setJobId((current) => queryId || storedId || current);
    };
    detect();
    const timer = window.setInterval(detect, 2_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(async () => {
    if (!jobId || requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(jobId)}/diagnostics`,
        { cache: "no-store", signal: controller.signal },
      );
      const raw = await response.text();
      let body: Diagnostic & { error?: string } = {};
      try {
        body = raw ? JSON.parse(raw) as Diagnostic & { error?: string } : {};
      } catch {
        throw new Error(`진단 응답을 읽지 못했습니다. HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(body.error || `정밀 상태 확인에 실패했습니다. HTTP ${response.status}`);
      const previous = diagnosticRef.current;
      const previousSignature = previous ? JSON.stringify({
        job: previous.job,
        progress: previous.progress,
        active: previous.current_active_chunk,
        health: previous.health,
      }) : null;
      const nextSignature = JSON.stringify({
        job: body.job,
        progress: body.progress,
        active: body.current_active_chunk,
        health: body.health,
      });
      setChanged(previousSignature === null ? null : previousSignature !== nextSignature);
      diagnosticRef.current = body;
      setDiagnostic(body);
      setLastCheckedAt(new Date().toISOString());
    } catch (caught) {
      const message = caught instanceof DOMException && caught.name === "AbortError"
        ? "15초 안에 상태 응답이 없어 요청을 중단했습니다. 서버 또는 네트워크 지연 가능성이 있습니다."
        : caught instanceof Error ? caught.message : "정밀 상태를 확인하지 못했습니다.";
      setError(message);
      setLastCheckedAt(new Date().toISOString());
    } finally {
      window.clearTimeout(timeout);
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [jobId, refresh]);

  const copyable = useMemo(() => JSON.stringify({
    copied_at: new Date().toISOString(),
    page_url: typeof window === "undefined" ? "" : window.location.href,
    job_id: jobId,
    last_checked_at: lastCheckedAt || null,
    request_error: error || null,
    diagnostic,
  }, null, 2), [diagnostic, error, jobId, lastCheckedAt]);

  if (!jobId) return null;

  const job = diagnostic?.job ?? {};
  const health = diagnostic?.health ?? {};
  const progress = diagnostic?.progress ?? {};
  const active = diagnostic?.current_active_chunk ?? null;
  const severityClass = health.severity === "error"
    ? "border-red-300 bg-red-50"
    : health.severity === "warning"
      ? "border-amber-300 bg-amber-50"
      : "border-emerald-300 bg-emerald-50";
  const completedChunks = number(progress.completed_normal_chunks);
  const normalChunks = number(progress.normal_chunk_count);

  const copy = async () => {
    await copyText(copyable);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return <section className={`mb-6 rounded-2xl border p-5 shadow-sm ${severityClass}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-slate-500">실시간 작업 상태</p>
        <h2 className="mt-1 text-xl font-black text-slate-950">{health.label ?? (loading ? "상태 확인 중" : "정밀 상태 확인")}</h2>
        <p className="mt-2 text-sm font-semibold text-slate-700">{health.message ?? "현재 작업의 서버 상태와 실행 묶음을 확인합니다."}</p>
        {health.recommended_action && <p className="mt-1 text-sm text-slate-600">조치: {health.recommended_action}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={loading} onClick={() => void refresh()} className="rounded-lg bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-50">
          {loading ? "확인 중..." : "정밀 상태 확인"}
        </button>
        <button type="button" onClick={() => void copy()} className="rounded-lg border border-slate-400 bg-white px-4 py-2 font-bold text-slate-900">
          {copied ? "복사됨" : "진단정보 복사"}
        </button>
      </div>
    </div>

    {error && <div role="alert" className="mt-4 rounded-lg border border-red-300 bg-white p-3 text-sm font-bold text-red-700">{error}</div>}

    <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-lg bg-white p-3"><dt className="text-xs text-slate-500">작업 진행</dt><dd className="mt-1 font-black">{normalChunks ? `${completedChunks}/${normalChunks}묶음` : "확인 중"}</dd></div>
      <div className="rounded-lg bg-white p-3"><dt className="text-xs text-slate-500">현재 실행 묶음</dt><dd className="mt-1 font-black">{active ? `${text(active.chunk_type)} #${text(active.chunk_index)}` : "없음"}</dd></div>
      <div className="rounded-lg bg-white p-3"><dt className="text-xs text-slate-500">현재 묶음 경과</dt><dd className="mt-1 font-black">{duration(health.active_chunk_age_seconds)}</dd></div>
      <div className="rounded-lg bg-white p-3"><dt className="text-xs text-slate-500">서버 마지막 확인</dt><dd className="mt-1 font-black">{duration(health.automation_last_tick_age_seconds)} 전</dd></div>
    </dl>

    <details className="mt-4 rounded-xl border border-slate-300 bg-white p-4" open={health.severity === "error"}>
      <summary className="cursor-pointer font-black">복사 가능한 상세 진단</summary>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <div><dt className="text-slate-500">작업번호</dt><dd className="break-all font-mono">{jobId}</dd></div>
        <div><dt className="text-slate-500">작업 상태</dt><dd className="font-mono">{text(job.status)}</dd></div>
        <div><dt className="text-slate-500">진단 코드</dt><dd className="font-mono">{text(health.code)}</dd></div>
        <div><dt className="text-slate-500">요청번호</dt><dd className="break-all font-mono">{active ? text(active.request_id) : "-"}</dd></div>
        <div><dt className="text-slate-500">묶음 시작</dt><dd>{active ? localTime(active.started_at) : "-"}</dd></div>
        <div><dt className="text-slate-500">묶음 마지막 갱신</dt><dd>{active ? localTime(active.updated_at) : "-"}</dd></div>
        <div><dt className="text-slate-500">자동 서버 확인</dt><dd>{localTime(job.automation_last_tick_at)}</dd></div>
        <div><dt className="text-slate-500">작업 마지막 갱신</dt><dd>{localTime(job.updated_at)}</dd></div>
        <div><dt className="text-slate-500">화면 마지막 확인</dt><dd>{localTime(lastCheckedAt)}</dd></div>
      </dl>
      {active && typeof active.actions_url === "string" && active.actions_url && <a href={active.actions_url} target="_blank" rel="noreferrer" className="mt-3 inline-block font-bold text-blue-700 underline">GitHub 실행 화면 열기</a>}
      <textarea readOnly value={copyable} aria-label="가격 변경 작업 진단정보" className="mt-3 min-h-56 w-full rounded-lg border bg-slate-50 p-3 font-mono text-xs text-slate-900" />
    </details>

    <p className="mt-3 text-xs text-slate-500">
      {loading ? "서버 응답을 기다리는 중입니다." : lastCheckedAt ? `마지막 확인 ${localTime(lastCheckedAt)}${changed === false ? " · 변화 없음" : changed === true ? " · 상태 변화 감지" : ""}` : "아직 확인하지 않았습니다."}
    </p>
  </section>;
}
