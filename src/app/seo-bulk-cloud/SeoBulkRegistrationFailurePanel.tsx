"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const SEO_RUN_API = "/api/seo-run-jobs";
const POLL_INTERVAL_MS = 4_000;

type UnknownRecord = Record<string, unknown>;
type RegistrationJob = {
  run_id: string;
  model_number: string;
  product_name: string;
  registration_status: "idle" | "submitting" | "queued" | "running" | "success" | "failed";
  registration_payload: UnknownRecord;
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

function readableError(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => readableError(entry, depth + 1))
      .filter(Boolean)
      .join(" · ")
      .slice(0, 1200);
  }
  if (typeof value === "object") {
    const row = value as UnknownRecord;
    for (const key of ["error", "message", "details", "reason", "code"]) {
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
      readableError(body.message) || readableError(body.error) || `HTTP ${response.status}`,
    );
  }
  return body;
}

function registrationError(job: RegistrationJob) {
  return (
    readableError(record(job.registration_payload).error) ||
    readableError(record(job.registration_payload).lastError) ||
    "Shopling 등록에 필요한 상품 정보가 부족하거나 등록 처리 중 오류가 발생했습니다."
  );
}

export default function SeoBulkRegistrationFailurePanel() {
  const [jobs, setJobs] = useState<RegistrationJob[]>([]);
  const [retryingRunId, setRetryingRunId] = useState("");
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
          : "Shopling 등록 실패 목록을 불러오지 못했습니다.",
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

  const retry = useCallback(
    async (job: RegistrationJob) => {
      setRetryingRunId(job.run_id);
      setError("");
      setMessage("");
      try {
        const body = await requestJson(SEO_RUN_API, {
          method: "POST",
          body: JSON.stringify({
            action: "queue_registration",
            runIds: [job.run_id],
          }),
        });
        setMessage(
          text(body.message) ||
            `${job.model_number || job.product_name || "상품"} 등록 재시도를 시작했습니다.`,
        );
        await load();
      } catch (retryError) {
        setError(
          retryError instanceof Error
            ? retryError.message
            : "Shopling 등록 재시도 요청에 실패했습니다.",
        );
      } finally {
        setRetryingRunId("");
      }
    },
    [load],
  );

  if (!failed.length && !error && !message) return null;

  return (
    <section className="mx-auto mt-5 max-w-[1500px] px-5">
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-black text-rose-900">
              Shopling 등록 실패 · 조치 필요 {failed.length ? `(${failed.length})` : ""}
            </div>
            <p className="mt-1 text-xs font-semibold leading-5 text-rose-800">
              아래 사유를 상품출시 진행관리에서 수정한 뒤 해당 상품의 ‘등록 실패 다시시도’를 누르세요.
              SEO FINAL 결과는 그대로 보존되고 Shopling 등록 단계만 다시 실행됩니다.
            </p>
          </div>
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-300 bg-white px-4 py-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        {failed.length ? (
          <div className="mt-4 grid gap-3">
            {failed.map((job) => {
              const detail = registrationError(job);
              return (
                <div
                  key={job.run_id}
                  className="rounded-xl border border-rose-200 bg-white p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-slate-950">
                          {job.model_number || "모델번호 없음"}
                        </span>
                        <span className="text-sm font-semibold text-slate-600">
                          {job.product_name}
                        </span>
                        <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-black text-rose-800">
                          등록 실패
                        </span>
                      </div>
                      <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
                        <div className="text-[11px] font-black text-rose-700">실패 사유</div>
                        <div className="mt-1 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-rose-900">
                          {detail}
                        </div>
                      </div>
                      <div className="mt-2 text-[11px] font-semibold text-slate-500">
                        마지막 확인 {job.updated_at ? new Date(job.updated_at).toLocaleString("ko-KR") : "-"}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(retryingRunId)}
                      onClick={() => void retry(job)}
                      className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
                    >
                      {retryingRunId === job.run_id
                        ? "재시도 요청 중…"
                        : "등록 실패 다시시도"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
