"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const SEO_RUN_API = "/api/seo-run-jobs";
const AUTO_API = "/api/shopling-market-auto-orchestration";
const BRIDGE_PROBE = "commerce-os-shopling-market-auto-probe-v0330";
const BRIDGE_PROBE_ACK = "commerce-os-shopling-market-auto-probe-ack-v0330";
const BRIDGE_HANDOFF = "commerce-os-shopling-market-auto-handoff-v0330";
const BRIDGE_HANDOFF_ACK = "commerce-os-shopling-market-auto-handoff-ack-v0330";
const PENDING_STORAGE_KEY = "commerceOs.shoplingMarketAutoHandoff.v0330";
const POLL_MS = 4_000;

type UnknownRecord = Record<string, unknown>;
type SeoRunRow = {
  run_id: string;
  status: string;
  registration_status: string;
  model_number: string;
};

type AutoRow = {
  id: string;
  state: string;
  run_ids: unknown;
  error_message: string;
  result: unknown;
  created_at: string;
  updated_at: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function requestJson(url: string, init?: RequestInit) {
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
  const body = record(await response.json().catch(() => ({})));
  if (!response.ok || body.ok !== true) {
    throw new Error(text(body.message) || text(body.error) || `HTTP ${response.status}`);
  }
  return body;
}

function waitForBridgeAck(type: string, requestId: string, timeoutMs: number) {
  return new Promise<UnknownRecord | null>((resolve) => {
    let done = false;
    const finish = (value: UnknownRecord | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const row = record(event.data);
      if (text(row.type) !== type || text(row.requestId) !== requestId) return;
      finish(row);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
  });
}

async function probeExtension() {
  const requestId = crypto.randomUUID();
  const pending = waitForBridgeAck(BRIDGE_PROBE_ACK, requestId, 1_800);
  window.postMessage({ type: BRIDGE_PROBE, requestId }, window.location.origin);
  const ack = await pending;
  return ack?.ok === true && text(ack.version) === "0.3.30";
}

async function handoffToExtension(orchestrationId: string, token: string) {
  const requestId = crypto.randomUUID();
  const pending = waitForBridgeAck(BRIDGE_HANDOFF_ACK, requestId, 3_000);
  window.postMessage(
    { type: BRIDGE_HANDOFF, requestId, orchestrationId, token },
    window.location.origin,
  );
  const ack = await pending;
  return ack?.ok === true;
}

function stateLabel(state: string) {
  return (
    {
      waiting_upload: "Shopling 업로드 대기",
      uploading: "Shopling 업로드 중",
      market_ready: "마켓전송 준비",
      market_claimed: "브라우저 에이전트 연결",
      market_running: "마켓전송 중",
      completed: "Shopling 업로드 + 마켓전송 완료",
      completed_with_exceptions: "완료 · 일부 예외 확인필요",
      exception: "예외",
      cancelled: "취소",
    }[state] ?? state
  ) || "대기";
}

function terminalState(state: string) {
  return ["completed", "completed_with_exceptions", "exception", "cancelled"].includes(state);
}

export default function SeoBulkShoplingOneClickControl() {
  const [jobs, setJobs] = useState<SeoRunRow[]>([]);
  const [orchestrations, setOrchestrations] = useState<AutoRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [bridgeReady, setBridgeReady] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const [runsBody, autoBody] = await Promise.all([
        requestJson(SEO_RUN_API),
        requestJson(AUTO_API),
      ]);
      setJobs(Array.isArray(runsBody.jobs) ? (runsBody.jobs as SeoRunRow[]) : []);
      setOrchestrations(
        Array.isArray(autoBody.orchestrations)
          ? (autoBody.orchestrations as AutoRow[])
          : [],
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "원클릭 상태 조회 실패");
    }
  }, []);

  const readyRuns = useMemo(
    () =>
      jobs.filter(
        (job) => job.status === "ready" && job.registration_status === "idle",
      ),
    [jobs],
  );
  const latest = orchestrations[0] ?? null;

  const retryPendingHandoff = useCallback(async () => {
    let pending: UnknownRecord = {};
    try {
      pending = record(JSON.parse(window.localStorage.getItem(PENDING_STORAGE_KEY) || "{}"));
    } catch {
      return;
    }
    const orchestrationId = text(pending.orchestrationId);
    const token = text(pending.token);
    if (!orchestrationId || !token) return;
    const available = await probeExtension();
    setBridgeReady(available);
    if (!available) return;
    if (await handoffToExtension(orchestrationId, token)) {
      window.localStorage.removeItem(PENDING_STORAGE_KEY);
      setMessage("브라우저 에이전트 연결 복구 완료 · Shopling 업로드 후 마켓전송까지 자동으로 이어집니다.");
    }
  }, []);

  useEffect(() => {
    void load();
    void retryPendingHandoff();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, retryPendingHandoff]);

  const start = useCallback(async () => {
    if (!readyRuns.length || busy) return;
    setBusy(true);
    setError("");
    setMessage("v0.3.30 브라우저 에이전트 연결을 확인합니다…");
    try {
      const available = await probeExtension();
      setBridgeReady(available);
      if (!available) {
        throw new Error("Shopling Market Sender v0.3.30이 연결되지 않았습니다. v0.3.30 설치 후 Shopling 관리자/A18 탭을 열고 다시 누르세요.");
      }
      setMessage(`${readyRuns.length}개 상품의 Shopling 업로드 + 마켓전송 원클릭 작업을 서버에 등록합니다…`);
      const body = await requestJson(AUTO_API, {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          runIds: readyRuns.map((row) => row.run_id),
        }),
      });
      const orchestrationId = text(body.orchestrationId);
      const token = text(body.handoffToken);
      if (!orchestrationId || !token) throw new Error("원클릭 작업 인계 토큰을 받지 못했습니다.");
      window.localStorage.setItem(
        PENDING_STORAGE_KEY,
        JSON.stringify({ orchestrationId, token, createdAt: Date.now() }),
      );
      let handed = false;
      for (let attempt = 0; attempt < 4 && !handed; attempt += 1) {
        if (attempt) await new Promise((resolve) => window.setTimeout(resolve, 700));
        handed = await handoffToExtension(orchestrationId, token);
      }
      if (!handed) {
        throw new Error("서버 작업은 생성됐지만 확장프로그램 인계 확인을 받지 못했습니다. 이 페이지를 유지하면 자동 재연결을 시도합니다.");
      }
      window.localStorage.removeItem(PENDING_STORAGE_KEY);
      setMessage(
        `${Number(body.acceptedCount || readyRuns.length)}개 상품 인계 완료 · 이제 Shopling 업로드 → 도매1~소매2 마켓전송까지 자동 진행합니다.`,
      );
      await load();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "원클릭 작업 시작 실패");
    } finally {
      setBusy(false);
    }
  }, [busy, load, readyRuns]);

  return (
    <section className="mx-auto mt-5 max-w-[1500px] px-5">
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-cyan-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
              COMMERCE OS · ONE CLICK SHOPLING PIPELINE
            </p>
            <h2 className="mt-1 text-xl font-black">Shopling 업로드 → 마켓전송 원클릭</h2>
            <p className="mt-1 text-sm text-slate-600">
              Shopling 로그인/A18 탭과 v0.3.30만 열어두면 확장프로그램 팝업을 조작하지 않아도 됩니다.
            </p>
          </div>
          <button
            type="button"
            disabled={busy || readyRuns.length === 0}
            onClick={() => void start()}
            className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-40"
          >
            {busy
              ? "원클릭 작업 연결 중…"
              : `샵플링 일괄 대량등록 및 마켓전송 (${readyRuns.length})`}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-white px-3 py-1 ring-1 ring-emerald-200">
            등록 가능 {readyRuns.length}개
          </span>
          <span className={`rounded-full px-3 py-1 ${bridgeReady === true ? "bg-emerald-100 text-emerald-800" : bridgeReady === false ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-600"}`}>
            브라우저 에이전트 {bridgeReady === true ? "v0.3.30 연결" : bridgeReady === false ? "연결 필요" : "확인 대기"}
          </span>
          {latest ? (
            <span className={`rounded-full px-3 py-1 ${terminalState(text(latest.state)) ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
              최근 원클릭 · {stateLabel(text(latest.state))}
            </span>
          ) : null}
        </div>
        {message ? <p className="mt-3 text-sm font-bold text-emerald-800">{message}</p> : null}
        {error ? <p className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}
        {latest?.error_message ? (
          <p className="mt-2 text-xs font-bold text-rose-700">최근 예외: {latest.error_message}</p>
        ) : null}
      </div>
    </section>
  );
}
