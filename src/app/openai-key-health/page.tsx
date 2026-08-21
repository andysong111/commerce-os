"use client";

import { useCallback, useEffect, useState } from "react";

type Lane = {
  id: string;
  label: string;
  envName: string;
  configured: boolean;
  ok: boolean;
  status: number | null;
  errorCode: string | null;
};

type HealthPayload = {
  ok?: boolean;
  checkedAt?: string;
  lanes?: Lane[];
  legacyFallbackConfigured?: boolean;
  note?: string;
  error?: string;
  message?: string;
};

export default function OpenAiKeyHealthPage() {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<HealthPayload | null>(null);
  const [requestError, setRequestError] = useState("");

  const check = useCallback(async () => {
    setLoading(true);
    setRequestError("");
    try {
      const response = await fetch("/api/openai-key-health", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as HealthPayload;
      setPayload(body);
      if (!response.ok && !Array.isArray(body.lanes)) {
        setRequestError(body.message || body.error || `HTTP ${response.status}`);
      }
    } catch {
      setRequestError("OpenAI key health check request failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const lanes = payload?.lanes ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-neutral-500">Commerce OS · OpenAI</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">API key health</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            Production 전용 키 4개의 OpenAI 인증 상태만 확인합니다. 비밀키 값은 화면이나 응답에 노출하지 않습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void check()}
          disabled={loading}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "검사 중…" : "다시 검사"}
        </button>
      </div>

      {requestError ? (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {requestError}
        </div>
      ) : null}

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        {lanes.map((lane) => (
          <article key={lane.id} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold">{lane.label}</h2>
                <code className="mt-2 block break-all text-xs text-neutral-500">{lane.envName}</code>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  lane.ok
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {lane.ok ? "OK" : "CHECK"}
              </span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-neutral-500">Configured</dt>
                <dd className="mt-1 font-medium">{lane.configured ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">OpenAI HTTP</dt>
                <dd className="mt-1 font-medium">{lane.status ?? "-"}</dd>
              </div>
              {lane.errorCode ? (
                <div className="col-span-2">
                  <dt className="text-neutral-500">Diagnostic</dt>
                  <dd className="mt-1 font-medium">{lane.errorCode}</dd>
                </div>
              ) : null}
            </dl>
          </article>
        ))}
      </section>

      {!loading && lanes.length ? (
        <section className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm">
          <p className="font-semibold">
            {payload?.ok ? "전용 키 4개 인증 정상" : "전용 키 점검 필요"}
          </p>
          <p className="mt-2 text-neutral-600">
            기존 공용 OPENAI_API_KEY fallback: {payload?.legacyFallbackConfigured ? "아직 설정됨" : "제거됨"}
          </p>
          {payload?.checkedAt ? (
            <p className="mt-1 text-xs text-neutral-500">Checked: {payload.checkedAt}</p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
