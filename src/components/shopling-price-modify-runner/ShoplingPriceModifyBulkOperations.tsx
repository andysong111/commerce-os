"use client";

import { useCallback, useEffect, useState } from "react";
import { ShoplingPriceModifyBulkErrorPanel } from "@/components/shopling-price-modify-runner/ShoplingPriceModifyBulkErrorPanel";
import { requestShoplingPriceBulkJson, ShoplingPriceBulkApiError } from "@/lib/shoplingPriceModifyBulkClient";
import { runShoplingPriceBulkLocalBenchmark } from "@/lib/shoplingPriceModifyBulkOps";

type Benchmark = ReturnType<typeof runShoplingPriceBulkLocalBenchmark>;
type ArchivedJob = {
  id: string;
  status: string;
  execution_mode?: string;
  valid_count: number;
  total_chunk_count: number;
  archived_at?: string | null;
  archive_note?: string | null;
  archive_previous_status?: string | null;
  created_at: string;
};
type OpsReport = {
  summary_only?: boolean;
  job: {
    id: string;
    status: string;
    execution_mode: string;
    valid_count: number;
    total_chunk_count: number;
    canary_size: number;
    normal_chunk_size: number;
    created_at: string;
    updated_at: string;
    archived_at?: string | null;
    archive_note?: string | null;
  };
  item_status_counts: Record<string, number>;
  chunk_status_counts: Record<string, number>;
  timing: {
    first_started_at?: string | null;
    completed_at?: string | null;
    last_updated_at?: string | null;
    elapsed_seconds?: number | null;
    succeeded_items_per_minute?: number | null;
  };
  chunks: Array<Record<string, unknown>>;
};
type AuditEvent = {
  id: number;
  entity_type: string;
  entity_id: string;
  event_type: string;
  old_status?: string | null;
  new_status?: string | null;
  request_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
};

const STORAGE_KEY = "shoplingPriceModifyBulkRecentJobId";
const ARCHIVEABLE_STATUSES = new Set([
  "prepared",
  "validation_only",
  "canary_failed",
  "normal_succeeded",
  "normal_failed",
  "retry_failed",
  "cancelled",
]);
const readCurrentJobId = () => {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("bulkJobId")
    ?? localStorage.getItem(STORAGE_KEY)
    ?? "";
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ShoplingPriceModifyBulkOperations() {
  const [jobId, setJobId] = useState("");
  const [report, setReport] = useState<OpsReport | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [archivedJobs, setArchivedJobs] = useState<ArchivedJob[]>([]);
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState("");

  const handleError = useCallback((caught: unknown, fallback: string, operation: string) => {
    if (caught instanceof ShoplingPriceBulkApiError) {
      setError(caught.message);
      setDiagnostic(caught.diagnosticText);
      return;
    }
    const message = caught instanceof Error ? caught.message : fallback;
    setError(message);
    setDiagnostic(JSON.stringify({ timestamp: new Date().toISOString(), operation, error: message }, null, 2));
  }, []);

  const clearMessages = useCallback(() => {
    setError("");
    setDiagnostic("");
    setNotice("");
  }, []);

  const loadArchived = useCallback(async () => {
    try {
      const body = await requestShoplingPriceBulkJson("/api/shopling-price-modify/bulk/jobs?archived=1", undefined, "bulk_ops.archived");
      setArchivedJobs(Array.isArray(body.jobs) ? body.jobs as ArchivedJob[] : []);
    } catch (caught) {
      handleError(caught, "보관된 Bulk 작업 조회에 실패했습니다.", "bulk_ops.archived");
    }
  }, [handleError]);

  const loadReport = useCallback(async (targetId: string) => {
    if (!targetId) return;
    setAudit([]);
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(targetId)}/report?format=json&summary=1`,
        undefined,
        "bulk_ops.report",
      );
      setReport(body as unknown as OpsReport);
      setJobId(targetId);
    } catch (caught) {
      handleError(caught, "운영 리포트 조회에 실패했습니다.", "bulk_ops.report");
    }
  }, [handleError]);

  const loadCurrent = useCallback(async () => {
    const targetId = readCurrentJobId();
    if (!targetId) {
      setNotice("먼저 저장된 Bulk 작업을 선택하세요.");
      return;
    }
    clearMessages();
    await loadReport(targetId);
  }, [clearMessages, loadReport]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadArchived();
      const targetId = readCurrentJobId();
      if (targetId) void loadReport(targetId);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loadArchived, loadReport]);

  const downloadReport = async (format: "json" | "csv") => {
    if (!jobId || busy) return;
    setBusy(true);
    clearMessages();
    try {
      const response = await fetch(`/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(jobId)}/report?format=${format}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`운영 리포트 다운로드에 실패했습니다. status=${response.status}`);
      downloadBlob(await response.blob(), format === "csv" ? `shopling-price-bulk-${jobId}-items.csv` : `shopling-price-bulk-${jobId}-report.json`);
      setNotice(format === "csv" ? "상품 결과 CSV를 다운로드했습니다." : "운영 리포트 JSON을 다운로드했습니다.");
    } catch (caught) {
      handleError(caught, "운영 리포트 다운로드에 실패했습니다.", `bulk_ops.download_${format}`);
    } finally {
      setBusy(false);
    }
  };

  const loadAudit = async () => {
    if (!jobId || busy) return;
    setBusy(true);
    clearMessages();
    try {
      const body = await requestShoplingPriceBulkJson(`/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(jobId)}/audit`, undefined, "bulk_ops.audit");
      const events = Array.isArray(body.events) ? body.events as AuditEvent[] : [];
      setAudit(events);
      setNotice(`감사 로그 ${events.length}개를 불러왔습니다. 화면에는 최신 100개만 표시하고 다운로드에는 전체 조회 결과를 포함합니다.`);
    } catch (caught) {
      handleError(caught, "감사 로그 조회에 실패했습니다.", "bulk_ops.audit");
    } finally {
      setBusy(false);
    }
  };

  const downloadAudit = () => {
    if (!jobId || audit.length === 0) return;
    downloadBlob(new Blob([JSON.stringify({ job_id: jobId, generated_at: new Date().toISOString(), events: audit }, null, 2)], { type: "application/json" }), `shopling-price-bulk-${jobId}-audit.json`);
  };

  const runBenchmark = () => {
    clearMessages();
    try {
      const result = runShoplingPriceBulkLocalBenchmark();
      setBenchmark(result);
      setNotice(result.passed ? "20,000개 로컬 파싱·청크 계획 검증을 통과했습니다." : "20,000개 로컬 검증 결과를 확인하세요.");
    } catch (caught) {
      handleError(caught, "20,000개 로컬 검증에 실패했습니다.", "bulk_ops.local_benchmark");
    }
  };

  const downloadBenchmark = () => {
    if (!benchmark) return;
    downloadBlob(new Blob([JSON.stringify(benchmark, null, 2)], { type: "application/json" }), "shopling-price-bulk-20000-local-benchmark.json");
  };

  const createValidationJob = async () => {
    if (busy) return;
    if (!window.confirm("20,000개의 합성 goods_key를 DB·청크·재접속 검증용으로만 저장합니다.\n가격 실행 버튼은 제공되지 않으며 GitHub Actions와 Shopling 요청을 생성하지 않습니다.\n계속하시겠습니까?")) return;
    setBusy(true);
    clearMessages();
    try {
      const body = await requestShoplingPriceBulkJson(
        "/api/shopling-price-modify/bulk/validation-jobs",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation: "CONFIRM_20000_VALIDATION_ONLY" }),
        },
        "bulk_ops.validation_create",
      );
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) throw new Error("검증 전용 작업번호가 없습니다.");
      localStorage.setItem(STORAGE_KEY, id);
      const url = new URL(window.location.href);
      url.searchParams.set("bulkJobId", id);
      window.location.assign(url.toString());
    } catch (caught) {
      handleError(caught, "20,000개 검증 전용 작업 저장에 실패했습니다.", "bulk_ops.validation_create");
      setBusy(false);
    }
  };

  const archiveCurrent = async () => {
    if (!jobId || busy) return;
    if (!window.confirm("현재 Bulk 작업을 보관합니다. 데이터는 삭제되지 않으며 보관 해제할 수 있습니다.\n계속하시겠습니까?")) return;
    setBusy(true);
    clearMessages();
    try {
      await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(jobId)}/archive`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "CONFIRM_BULK_ARCHIVE", note: "manual archive" }) },
        "bulk_ops.archive",
      );
      window.location.reload();
    } catch (caught) {
      handleError(caught, "작업 보관에 실패했습니다.", "bulk_ops.archive");
      setBusy(false);
    }
  };

  const restoreJob = async (targetId: string) => {
    if (busy) return;
    if (!window.confirm("이 Bulk 작업의 보관을 해제하시겠습니까?")) return;
    setBusy(true);
    clearMessages();
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(targetId)}/restore`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "CONFIRM_BULK_RESTORE" }) },
        "bulk_ops.restore",
      );
      if (targetId === jobId) {
        window.location.reload();
        return;
      }
      setNotice(String(body.message));
      await loadArchived();
    } catch (caught) {
      handleError(caught, "보관 해제에 실패했습니다.", "bulk_ops.restore");
    } finally {
      setBusy(false);
    }
  };

  const archiveStale = async () => {
    if (busy) return;
    if (!window.confirm(`${days}일보다 오래된 미실행 준비·검증 작업만 보관합니다. 삭제하지 않습니다.\n계속하시겠습니까?`)) return;
    setBusy(true);
    clearMessages();
    try {
      const body = await requestShoplingPriceBulkJson(
        "/api/shopling-price-modify/bulk/jobs/archive-stale",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "CONFIRM_ARCHIVE_STALE_PREPARED", older_than_days: days }) },
        "bulk_ops.archive_stale",
      );
      const archivedCount = Number(body.archived_count ?? 0);
      if (archivedCount > 0) {
        window.location.reload();
        return;
      }
      setNotice(String(body.message));
      await loadArchived();
    } catch (caught) {
      handleError(caught, "오래된 작업 보관에 실패했습니다.", "bulk_ops.archive_stale");
    } finally {
      setBusy(false);
    }
  };

  const mode = report?.job.execution_mode ?? "live";
  const archived = Boolean(report?.job.archived_at);
  const pendingNormal = report?.chunks.some((chunk) => chunk.chunk_type === "normal" && ["pending", "dispatching", "running", "dispatch_uncertain"].includes(String(chunk.status))) ?? false;
  const archiveAllowed = Boolean(report && !archived && (ARCHIVEABLE_STATUSES.has(report.job.status) || (report.job.status === "canary_succeeded" && !pendingNormal)));
  const chunkCountSummary = report
    ? Object.entries(report.chunk_status_counts).filter(([, count]) => count > 0).map(([status, count]) => `${status} ${count}`).join(" · ") || "-"
    : "-";

  return <section className="rounded-2xl border border-violet-200 bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold text-slate-950">운영 검증·관측·정리</h2>
    <p className="mt-2 text-sm text-slate-600">공식 운영 점수 90/100 이후 중규모 실증, 20,000개 가격 무쓰기 검증, 리포트·감사 로그·보관 기능을 관리합니다.</p>

    {error && <ShoplingPriceModifyBulkErrorPanel summary={error} diagnostic={diagnostic} />}
    {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 font-bold text-emerald-800">{notice}</p>}

    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void loadCurrent()} className="rounded-lg bg-slate-800 px-4 py-2 font-bold text-white disabled:opacity-50">현재 작업 다시 불러오기</button>
      {report && <>
        <button type="button" disabled={busy} onClick={() => void downloadReport("json")} className="rounded-lg bg-violet-700 px-4 py-2 font-bold text-white disabled:opacity-50">운영 리포트 JSON 다운로드</button>
        <button type="button" disabled={busy} onClick={() => void downloadReport("csv")} className="rounded-lg bg-violet-700 px-4 py-2 font-bold text-white disabled:opacity-50">상품 결과 CSV 다운로드</button>
        <button type="button" disabled={busy} onClick={() => void loadAudit()} className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">감사 로그 보기</button>
        {archiveAllowed && <button type="button" disabled={busy} onClick={() => void archiveCurrent()} className="rounded-lg bg-amber-700 px-4 py-2 font-bold text-white disabled:opacity-50">작업 보관</button>}
        {archived && <button type="button" disabled={busy} onClick={() => void restoreJob(jobId)} className="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white disabled:opacity-50">보관 해제</button>}
      </>}
    </div>

    {report && <div className="mt-5 rounded-xl border p-4">
      <p className={`rounded-lg p-3 font-bold ${mode === "validation_only" ? "bg-amber-100 text-amber-950" : "bg-blue-50 text-blue-950"}`}>
        실행 모드: {mode === "validation_only" ? "가격 무쓰기 검증 · 가격 실행 잠금" : "LIVE"}{archived ? " · 보관됨" : ""}
      </p>
      <dl className="mt-4 grid gap-2 sm:grid-cols-3">{[
        ["작업번호", report.job.id],
        ["작업 상태", report.job.status],
        ["총 상품", report.job.valid_count],
        ["총 청크", report.job.total_chunk_count],
        ["청크 상태", chunkCountSummary],
        ["성공 상품", report.item_status_counts.succeeded ?? 0],
        ["실패 상품", report.item_status_counts.failed ?? 0],
        ["대기 상품", report.item_status_counts.pending ?? 0],
        ["경과 시간(초)", report.timing.elapsed_seconds ?? "-"],
        ["성공 상품/분", report.timing.succeeded_items_per_minute ?? "-"],
        ["첫 실행", report.timing.first_started_at ? new Date(report.timing.first_started_at).toLocaleString("ko-KR") : "-"],
        ["최근 갱신", new Date(report.job.updated_at).toLocaleString("ko-KR")],
        ["보관 시각", report.job.archived_at ? new Date(report.job.archived_at).toLocaleString("ko-KR") : "-"],
      ].map(([key, value]) => <div className="rounded-lg bg-slate-50 p-3" key={String(key)}><dt className="text-xs text-slate-500">{key}</dt><dd className="break-all font-bold">{value}</dd></div>)}</dl>
      {mode === "validation_only" && <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-900">이 작업은 20,000개 DB·청크·재접속 검증용입니다. 카나리·일반·재시도 가격 실행 경로를 사용할 수 없습니다.</p>}
    </div>}

    {audit.length > 0 && <div className="mt-5 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="font-bold">감사 로그 최근 {Math.min(audit.length, 100)}개 / 조회 {audit.length}개</h3><button type="button" onClick={downloadAudit} className="rounded bg-slate-800 px-3 py-2 text-white">감사 로그 JSON 다운로드</button></div>
      <div className="mt-3 max-h-80 overflow-auto text-sm">{audit.slice(0, 100).map((event) => <div className="border-b py-2" key={event.id}><p><strong>{new Date(event.created_at).toLocaleString("ko-KR")}</strong> · {event.entity_type} · {event.event_type}</p><p className="text-slate-600">{event.old_status ?? "-"} → {event.new_status ?? "-"} · request_id {event.request_id ?? "-"}</p></div>)}</div>
    </div>}

    <div className="mt-6 rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
      <h3 className="text-lg font-bold text-amber-950">20,000개 가격 무쓰기 부하검증</h3>
      <p className="mt-2 text-sm text-amber-900">로컬 검증은 브라우저 파서·청크 계획만 실행합니다. DB 검증 작업은 합성 번호를 저장하지만 GitHub Actions와 Shopling 가격 요청을 만들 수 없습니다.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={runBenchmark} className="rounded-lg bg-amber-700 px-4 py-2 font-bold text-white disabled:opacity-50">20,000개 로컬 파싱 검증</button>
        <button type="button" disabled={busy} onClick={() => void createValidationJob()} className="rounded-lg bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50">20,000개 검증 전용 작업 저장</button>
        {benchmark && <button type="button" onClick={downloadBenchmark} className="rounded-lg bg-slate-800 px-4 py-2 font-bold text-white">벤치마크 JSON 다운로드</button>}
      </div>
      {benchmark && <dl className="mt-4 grid gap-2 sm:grid-cols-3">{Object.entries(benchmark).map(([key, value]) => <div className="rounded bg-white p-3" key={key}><dt className="text-xs text-slate-500">{key}</dt><dd className="font-bold">{String(value)}</dd></div>)}</dl>}
    </div>

    <div className="mt-6 rounded-xl border p-4">
      <h3 className="font-bold">오래된 준비·검증 작업 보관</h3>
      <p className="mt-1 text-sm text-slate-600">실행된 적 없는 prepared/validation_only 작업만 수동 보관합니다. 삭제하지 않습니다.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="rounded border p-2">{[7, 14, 30, 60, 90].map((value) => <option key={value} value={value}>{value}일</option>)}</select>
        <button type="button" disabled={busy} onClick={() => void archiveStale()} className="rounded bg-amber-700 px-4 py-2 font-bold text-white disabled:opacity-50">오래된 준비·검증 작업 보관</button>
      </div>
    </div>

    <details className="mt-6 rounded-xl border p-4">
      <summary className="cursor-pointer font-bold">보관된 Bulk 작업 ({archivedJobs.length})</summary>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">생성시간</th><th className="p-2">보관 전 상태</th><th className="p-2">상품 수</th><th className="p-2">작업번호</th><th className="p-2">작업</th></tr></thead><tbody>{archivedJobs.map((job) => <tr key={job.id} className="border-t"><td className="p-2">{new Date(job.created_at).toLocaleString("ko-KR")}</td><td className="p-2">{job.archive_previous_status ?? job.status}</td><td className="p-2">{job.valid_count}</td><td className="p-2 font-mono text-xs">{job.id}</td><td className="p-2"><button type="button" disabled={busy} onClick={() => void restoreJob(job.id)} className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50">보관 해제</button></td></tr>)}</tbody></table></div>
    </details>
  </section>;
}
