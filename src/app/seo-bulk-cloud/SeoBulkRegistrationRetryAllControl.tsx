"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const SEO_RUN_API = "/api/seo-run-jobs";
const POLL_INTERVAL_MS = 4_000;

type UnknownRecord = Record<string, unknown>;
type RegistrationJob = {
  run_id: string;
  registration_status:
    | "idle"
    | "submitting"
    | "queued"
    | "running"
    | "success"
    | "failed";
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function readableError(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => readableError(entry, depth + 1))
      .filter(Boolean)
      .join(" · ")
      .slice(0, 700);
  }
  if (typeof value === "object") {
    const row = value as UnknownRecord;
    for (const key of ["message", "error", "details", "reason", "code"]) {
      const message = readableError(row[key], depth + 1);
      if (message) return message;
    }
  }
  return "";
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
  const raw = await response.text();
  let parsed: unknown = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`서버가 JSON이 아닌 응답을 반환했습니다. HTTP ${response.status}`);
  }
  const body = record(parsed);
  if (!response.ok || body.ok !== true) {
    throw new Error(
      readableError(body.message) ||
        readableError(body.error) ||
        `HTTP ${response.status}`,
    );
  }
  return body;
}

export default function SeoBulkRegistrationRetryAllControl() {
  const [jobs, setJobs] = useState<RegistrationJob[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const body = await requestJson(SEO_RUN_API);
      const rows = Array.isArray(body.jobs) ? body.jobs : [];
      setJobs(
        rows
          .map((value) => record(value) as unknown as RegistrationJob)
          .filter((job) => text(job.run_id)),
      );
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Shopling 등록 실패 건수를 불러오지 못했습니다.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const failed = useMemo(
    () => jobs.filter((job) => job.registration_status === "failed"),
    [jobs],
  );

  const retryAll = useCallback(async () => {
    if (!failed.length || retrying) return;
    setRetrying(true);
    setMessage("");
    setError("");
    try {
      const body = await requestJson(SEO_RUN_API, {
        method: "POST",
        body: JSON.stringify({
          action: "queue_registration",
          runIds: failed.map((job) => job.run_id),
          retryFailed: true,
        }),
      });
      setMessage(
        text(body.message) ||
          `${failed.length}개 등록 실패 상품의 일괄 재시도를 시작했습니다.`,
      );
      await load();
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Shopling 등록 실패 일괄 재시도 요청에 실패했습니다.",
      );
    } finally {
      setRetrying(false);
    }
  }, [failed, load, retrying]);

  if (!failed.length && !message && !error) return null;

  return (
    <section className="mx-auto mt-3 max-w-[1500px] px-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <div className="text-sm font-black text-slate-900">
            등록 실패 일괄 재시도
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-600">
            필요한 판매가·상세페이지·바코드 등을 수정한 뒤 누르면 현재 실패 건을 한 번에 다시 서버 등록큐로 보냅니다.
          </div>
          {message ? (
            <div className="mt-2 text-xs font-bold text-emerald-700">{message}</div>
          ) : null}
          {error ? (
            <div className="mt-2 text-xs font-bold text-rose-700">{error}</div>
          ) : null}
        </div>
        <button
          type="button"
          disabled={!failed.length || retrying}
          onClick={() => void retryAll()}
          className="rounded-xl bg-rose-700 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40"
        >
          {retrying
            ? "일괄 재시도 요청 중…"
            : `등록 실패 일괄 재시도 실행 (${failed.length})`}
        </button>
      </div>
    </section>
  );
}
