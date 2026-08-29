"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const SEO_RUN_ARCHIVE_API = "/api/seo-run-jobs?includeArchived=true";
const ARCHIVE_POLL_INTERVAL_MS = 30_000;

type UnknownRecord = Record<string, unknown>;
type ArchiveRun = {
  run_id: string;
  registration_status: string;
  archived_at: string | null;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

async function loadArchiveRuns() {
  const response = await fetch(SEO_RUN_ARCHIVE_API, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const raw = await response.text();
  const body = record(raw ? JSON.parse(raw) : {});
  if (!response.ok || body.ok !== true) {
    throw new Error("보관 완료 건수를 불러오지 못했습니다.");
  }
  return (Array.isArray(body.jobs) ? body.jobs : [])
    .map((value) => record(value) as unknown as ArchiveRun)
    .filter((run) => String(run.run_id ?? "").trim());
}

export default function SeoBulkArchiveSummary() {
  const [runs, setRuns] = useState<ArchiveRun[]>([]);

  const load = useCallback(async () => {
    try {
      setRuns(await loadArchiveRuns());
    } catch {
      // 보관 통계는 보조 UI이므로 본 작업 화면을 막지 않습니다.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), ARCHIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const archivedSuccessCount = useMemo(
    () =>
      runs.filter(
        (run) =>
          Boolean(run.archived_at) && run.registration_status === "success",
      ).length,
    [runs],
  );

  if (!archivedSuccessCount) return null;

  return (
    <section className="mx-auto mt-3 max-w-[1500px] px-5">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-950 shadow-sm">
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black ring-1 ring-emerald-200">
          보관완료 누적 {archivedSuccessCount}
        </span>
        <span className="text-xs font-bold leading-5">
          위 숫자는 Shopling 등록 성공 후 보관한 카드입니다. 아래 ‘등록완료 x/y’는 현재 활성 목록만 계산합니다.
        </span>
      </div>
    </section>
  );
}
