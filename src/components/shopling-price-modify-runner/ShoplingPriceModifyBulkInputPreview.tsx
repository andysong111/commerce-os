"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { ShoplingPriceModifyBulkErrorPanel } from "@/components/shopling-price-modify-runner/ShoplingPriceModifyBulkErrorPanel";
import {
  parseShoplingPriceBulkFile,
  parseShoplingPriceBulkPaste,
  plannedShoplingPriceBulkChunkCount,
  type ShoplingPriceBulkInputResult,
} from "@/lib/shoplingPriceModifyBulkInput";
import {
  requestShoplingPriceBulkJson,
  ShoplingPriceBulkApiError,
} from "@/lib/shoplingPriceModifyBulkClient";

type Selection = { label: string; result: ShoplingPriceBulkInputResult };
type Job = {
  id: string;
  status: string;
  input_source: string;
  original_count: number;
  valid_count: number;
  duplicate_count: number;
  invalid_count: number;
  canary_size?: number;
  normal_chunk_size?: number;
  total_chunk_count: number;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
  pause_requested?: boolean;
  retry_round?: number;
  max_retry_rounds?: number;
  retry_resume_status?: string | null;
  retry_scope_known?: boolean;
  automation_mode?: string;
  automation_stop_reason?: string | null;
  automation_finished_at?: string | null;
};
type Chunk = {
  chunk_index: number;
  chunk_type: string;
  goods_key_count: number;
  status: string;
  request_id?: string | null;
  actions_url?: string | null;
  result_summary?: Record<string, unknown> | null;
  last_error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string;
  retry_round?: number;
};
type StatusCounts = { pending: number; succeeded: number; failed: number };
type FailedItem = { goods_key: string; ordinal: number; last_error?: string | null; attempt_count: number };
type Detail = {
  job: Job;
  chunks: Chunk[];
  first_goods_keys: string[];
  last_goods_keys: string[];
  item_status_counts: StatusCounts;
  chunk_status_counts: StatusCounts & {
    dispatching: number;
    running: number;
    recovered?: number;
    superseded?: number;
    dispatch_uncertain: number;
  };
  normal_chunk_count: number;
  retry_chunk_count: number;
  current_retry_round_chunk_count: number;
  recovered_chunk_count: number;
  superseded_chunk_count: number;
  failed_goods_key_count: number;
  failed_goods_keys_preview: string[];
  failed_items_preview: FailedItem[];
  failed_preview_limit: number;
  failed_preview_truncated: boolean;
  current_active_chunk: Chunk | null;
};

const STORAGE_KEY = "shoplingPriceModifyBulkRecentJobId";
const STATUS_LABELS: Record<string, string> = {
  prepared: "실행 전 준비 완료",
  canary_dispatching: "카나리 전송 중",
  canary_running: "카나리 실행 중",
  canary_succeeded: "카나리 성공 · 일반 실행 승인 대기",
  canary_failed: "카나리 실패 · 점검 필요",
  dispatch_uncertain: "전송 여부 불확실 · 중복 실행 금지",
  normal_running: "일반 청크 직렬 실행 중",
  normal_succeeded: "전체 가격설정 완료",
  normal_failed: "일반 청크 실패 · 자동 중단",
  normal_paused: "일반 청크 직렬 실행 일시중지",
  retry_running: "실패 상품 제한 재실행 중",
  retry_paused: "실패 상품 재실행 일시중지",
  retry_failed: "재실행에도 실패 상품 존재 · 자동 중단",
  cancelled: "취소됨",
};
const CHUNK_STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  dispatching: "전송 중",
  running: "실행 중",
  succeeded: "성공",
  failed: "실패",
  recovered: "재실행 복구",
  superseded: "다음 재시도로 대체",
  dispatch_uncertain: "전송 여부 불확실",
};
const labelStatus = (status: string) => STATUS_LABELS[status] ?? status;
const labelChunkStatus = (status: string) => CHUNK_STATUS_LABELS[status] ?? status;
const labelSource = (source: string) => source === "paste" ? "직접 붙여넣기" : source.toUpperCase();

export function ShoplingPriceModifyBulkInputPreview() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [normalBusy, setNormalBusy] = useState(false);
  const normalBusyRef = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");

  const handleError = useCallback((caught: unknown, fallback: string, operation: string) => {
    if (caught instanceof ShoplingPriceBulkApiError) {
      setError(caught.message);
      setErrorDetail(caught.diagnosticText);
      return;
    }
    const message = caught instanceof Error ? caught.message : fallback;
    setError(message);
    setErrorDetail(JSON.stringify({
      timestamp: new Date().toISOString(),
      operation,
      error: message,
    }, null, 2));
  }, []);

  const clearMessages = useCallback(() => {
    setError("");
    setErrorDetail("");
    setNotice("");
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const body = await requestShoplingPriceBulkJson("/api/shopling-price-modify/bulk/jobs", undefined, "bulk.jobs.list");
      setJobs(Array.isArray(body.jobs) ? body.jobs as Job[] : []);
    } catch (caught) {
      handleError(caught, "최근 Bulk 작업 조회에 실패했습니다.", "bulk.jobs.list");
    }
  }, [handleError]);

  const loadDetail = useCallback(async (jobId: string) => {
    if (!jobId) return;
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(jobId)}`,
        undefined,
        "bulk.jobs.detail",
      );
      setDetail(body as unknown as Detail);
      localStorage.setItem(STORAGE_KEY, jobId);
      const url = new URL(window.location.href);
      url.searchParams.set("bulkJobId", jobId);
      window.history.replaceState(null, "", url);
    } catch (caught) {
      handleError(caught, "Bulk 작업 상세 조회에 실패했습니다.", "bulk.jobs.detail");
    }
  }, [handleError]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadJobs();
      const queryId = new URLSearchParams(window.location.search).get("bulkJobId");
      const storedId = localStorage.getItem(STORAGE_KEY);
      const targetId = queryId ?? storedId;
      if (targetId) void loadDetail(targetId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs, loadDetail]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReading(true);
    clearMessages();
    try {
      setSelection({ label: file.name, result: await parseShoplingPriceBulkFile(file) });
    } catch (caught) {
      handleError(caught, "파일을 읽을 수 없습니다.", "bulk.input.file");
    } finally {
      setReading(false);
    }
  };

  const onPaste = (value: string) => {
    clearMessages();
    try {
      setSelection({ label: "직접 붙여넣기", result: parseShoplingPriceBulkPaste(value) });
    } catch (caught) {
      handleError(caught, "붙여넣기 입력을 확인할 수 없습니다.", "bulk.input.paste");
    }
  };

  const savePrepared = async () => {
    if (!selection || selection.result.validCount === 0 || busy) return;
    setBusy(true);
    clearMessages();
    try {
      const result = selection.result;
      const body = await requestShoplingPriceBulkJson(
        "/api/shopling-price-modify/bulk/jobs",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input_source: result.source,
            goods_keys: result.goodsKeys,
            original_count: result.originalCount,
            duplicate_count: result.duplicateCount,
            invalid_count: result.invalidCount,
          }),
        },
        "bulk.jobs.create",
      );
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) throw new Error("저장된 작업번호가 없습니다.");
      setNotice("Bulk 준비 작업을 저장했습니다. 아직 Shopling 가격은 수정되지 않았습니다.");
      await Promise.all([loadJobs(), loadDetail(id)]);
    } catch (caught) {
      handleError(caught, "Bulk 준비 작업 저장에 실패했습니다.", "bulk.jobs.create");
    } finally {
      setBusy(false);
    }
  };

  const autoManaged = detail?.job.automation_mode === "auto";

  const runCanary = async () => {
    if (!detail || busy || autoManaged) return;
    if (!window.confirm(`카나리 ${detail.job.canary_size ?? 10}개 상품만 실제 가격설정을 실행합니다.\n일반 청크는 자동 실행되지 않습니다.\n계속하시겠습니까?`)) return;
    setBusy(true);
    clearMessages();
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/canary/dispatch`,
        { method: "POST" },
        "bulk.canary.dispatch",
      );
      setNotice(typeof body.message === "string" ? body.message : "카나리 실행 요청을 전송했습니다.");
      await loadDetail(detail.job.id);
    } catch (caught) {
      handleError(caught, "카나리 실행 요청에 실패했습니다.", "bulk.canary.dispatch");
    } finally {
      setBusy(false);
    }
  };

  const checkCanary = async () => {
    if (!detail || busy || autoManaged) return;
    setBusy(true);
    clearMessages();
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/canary/result`,
        { method: "POST" },
        "bulk.canary.result",
      );
      setNotice(typeof body.message === "string" ? body.message : "카나리 결과를 확인했습니다.");
      await Promise.all([loadJobs(), loadDetail(detail.job.id)]);
    } catch (caught) {
      handleError(caught, "카나리 결과 확인에 실패했습니다.", "bulk.canary.result");
    } finally {
      setBusy(false);
    }
  };

  const approveNormal = async () => {
    if (!detail || busy || autoManaged) return;
    if (!window.confirm(`카나리 성공을 확인했습니다.\n남은 ${detail.item_status_counts.pending}개 상품을 최대 50개씩 직렬 실행하도록 승인합니다.\n한 번에 한 청크만 실행하며 실패 또는 불확실 상태에서 자동 중단됩니다.\n계속하시겠습니까?`)) return;
    setBusy(true);
    clearMessages();
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/normal/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation: "CONFIRM_NORMAL_BULK_EXECUTION" }),
        },
        "bulk.normal.approve",
      );
      setNotice(typeof body.message === "string" ? body.message : "일반 상품 직렬 실행을 승인했습니다.");
      await loadDetail(detail.job.id);
    } catch (caught) {
      handleError(caught, "일반 상품 직렬 실행 승인에 실패했습니다.", "bulk.normal.approve");
    } finally {
      setBusy(false);
    }
  };

  const runSerialStep = useCallback(async (job: Detail) => {
    if (job.job.automation_mode === "auto") return;
    const retryMode = job.job.status === "retry_running";
    const activeRetry = job.current_active_chunk?.chunk_type === "retry";
    const activeNormal = job.current_active_chunk?.chunk_type === "normal";
    const recoveringUncertain = job.job.status === "dispatch_uncertain";
    const endpoint = retryMode || activeRetry ? "retry" : "normal";
    const action = recoveringUncertain ? "result" : (activeNormal || activeRetry ? "result" : "advance");
    await requestShoplingPriceBulkJson(
      `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(job.job.id)}/${endpoint}/${action}`,
      { method: "POST" },
      `bulk.${endpoint}.${action}`,
    );
  }, []);

  useEffect(() => {
    if (!detail || detail.job.automation_mode === "auto") return;
    const activeNormal = detail.current_active_chunk?.chunk_type === "normal";
    const activeRetry = detail.current_active_chunk?.chunk_type === "retry";
    const serialStatus = ["normal_running", "retry_running"].includes(detail.job.status);
    const recoveringUncertain = detail.job.status === "dispatch_uncertain" && (activeNormal || activeRetry);
    if (!serialStatus && !recoveringUncertain) return;
    if (normalBusyRef.current) return;

    const timer = window.setTimeout(() => {
      normalBusyRef.current = true;
      setNormalBusy(true);
      void runSerialStep(detail)
        .then(async () => {
          await Promise.all([loadJobs(), loadDetail(detail.job.id)]);
        })
        .catch((caught) => {
          handleError(caught, "직렬 실행 단계 처리에 실패했습니다.", "bulk.serial.loop");
        })
        .finally(() => {
          normalBusyRef.current = false;
          setNormalBusy(false);
        });
    }, activeNormal || activeRetry ? 7_000 : 1_000);
    return () => window.clearTimeout(timer);
  }, [detail, handleError, loadDetail, loadJobs, runSerialStep]);

  const approveRetry = async () => {
    if (!detail || busy || detail.failed_goods_key_count === 0) return;
    if (!window.confirm(`실패 상품 ${detail.failed_goods_key_count}개만 재실행 승인합니다.\n이미 성공한 상품은 다시 실행하지 않습니다.\n최대 2회까지만 허용됩니다.\n계속하시겠습니까?`)) return;
    setBusy(true);
    clearMessages();
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/retry/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation: "CONFIRM_FAILED_GOODS_RETRY" }),
        },
        "bulk.retry.approve",
      );
      setNotice(typeof body.message === "string" ? body.message : "실패 상품만 재실행하도록 승인했습니다.");
      await loadDetail(detail.job.id);
    } catch (caught) {
      handleError(caught, "실패 상품 재실행 승인에 실패했습니다.", "bulk.retry.approve");
    } finally {
      setBusy(false);
    }
  };

  const control = async (action: "pause" | "resume") => {
    if (!detail || busy) return;
    const confirmation = action === "pause" ? "CONFIRM_BULK_PAUSE" : "CONFIRM_BULK_RESUME";
    const message = action === "pause"
      ? "현재 청크 완료 후 일시중지합니다. 활성 청크가 없으면 즉시 멈춥니다."
      : "직렬 실행 재개를 승인합니다.";
    if (!window.confirm(`${message}\n계속하시겠습니까?`)) return;
    setBusy(true);
    clearMessages();
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/control/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation }),
        },
        `bulk.control.${action}`,
      );
      setNotice(typeof body.message === "string" ? body.message : message);
      await loadDetail(detail.job.id);
    } catch (caught) {
      handleError(caught, action === "pause" ? "일시중지 요청에 실패했습니다." : "직렬 실행 재개에 실패했습니다.", `bulk.control.${action}`);
    } finally {
      setBusy(false);
    }
  };

  const copyFailed = async () => {
    if (!detail || detail.failed_goods_key_count === 0 || busy) return;
    setBusy(true);
    clearMessages();
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/failed-keys`,
        undefined,
        "bulk.failed_keys",
      );
      const keys = Array.isArray(body.goods_keys)
        ? body.goods_keys.filter((value): value is string => typeof value === "string")
        : [];
      if (keys.length !== detail.failed_goods_key_count) {
        throw new Error(`실패 상품 전체 조회 수가 일치하지 않습니다. expected=${detail.failed_goods_key_count} actual=${keys.length}`);
      }
      await navigator.clipboard.writeText(keys.join("\n"));
      setNotice(`실패 goods_key ${keys.length}개 전체를 복사했습니다.`);
    } catch (caught) {
      handleError(caught, "실패 goods_key 전체 복사에 실패했습니다.", "bulk.failed_keys");
    } finally {
      setBusy(false);
    }
  };

  const preview = selection?.result;
  const canary = detail?.chunks.find((chunk) => chunk.chunk_index === 0 && chunk.chunk_type === "canary");
  const retryLimitReached = detail
    ? (detail.job.retry_round ?? 0) >= (detail.job.max_retry_rounds ?? 2)
    : false;
  const retryAllowed = Boolean(
    detail
      && ["canary_failed", "normal_failed", "retry_failed"].includes(detail.job.status)
      && detail.failed_goods_key_count > 0
      && detail.job.retry_scope_known !== false
      && !retryLimitReached,
  );
  const pauseAllowed = Boolean(
    detail
      && ["normal_running", "retry_running"].includes(detail.job.status)
      && !detail.job.pause_requested,
  );
  const resumeAllowed = Boolean(
    detail
      && ["normal_paused", "retry_paused"].includes(detail.job.status),
  );
  const successPercent = detail && detail.job.valid_count > 0
    ? Math.floor(detail.item_status_counts.succeeded * 100 / detail.job.valid_count)
    : 0;

  return <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold text-slate-950">대량 가격설정 입력 준비</h2>
    <p className="mt-2 text-sm text-slate-600">Bulk 실행 전 goods_key 입력을 검사합니다. 준비 작업 저장만으로는 가격을 수정하지 않습니다. 이 단계에서는 실제 가격을 수정하지 않습니다.</p>

    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <label className="rounded-xl border p-4">
        <span className="font-bold">엑셀·CSV 파일 업로드</span>
        <input type="file" accept=".xlsx,.csv" onChange={onFile} className="mt-3 block w-full" />
        <span className="mt-2 block text-xs text-slate-500">고정 양식: 첫 시트 A열만 사용 · A1 goods_key · A2부터 상품번호 · B열 이후 데이터 금지</span>
      </label>
      <label className="rounded-xl border p-4">
        <span className="font-bold">직접 붙여넣기</span>
        <textarea onChange={(event) => onPaste(event.target.value)} className="mt-3 min-h-36 w-full rounded-lg border p-3 font-mono text-sm" placeholder="쉼표, 공백, 탭, 줄바꿈을 사용할 수 있습니다." />
      </label>
    </div>
    {reading && <p className="mt-3 text-sm">파일을 읽고 있습니다.</p>}
    {error && <ShoplingPriceModifyBulkErrorPanel summary={error} diagnostic={errorDetail} />}
    {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 font-bold text-emerald-800">{notice}</p>}

    {preview && <div className="mt-5 rounded-xl border p-5">
      <h3 className="font-bold">실행 전 미리보기</h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">{[
        ["입력 방식", labelSource(preview.source)],
        ["원본 행 수", preview.originalCount],
        ["유효 goods_key 수", preview.validCount],
        ["중복 제거 수", preview.duplicateCount],
        ["invalid 수", preview.invalidCount],
        ["예상 쇼핑몰 가격 수정 행 수", preview.validCount * 24],
        ["카나리 크기", Math.min(preview.validCount, 10)],
        ["일반 청크 크기", 50],
        ["총 청크 수", plannedShoplingPriceBulkChunkCount(preview.validCount)],
      ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="font-bold">{value}</dd></div>)}</dl>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">goods_key 첫 20개</p><pre className="mt-2 whitespace-pre-wrap text-xs">{preview.goodsKeys.slice(0, 20).join("\n") || "-"}</pre></div>
        <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">goods_key 마지막 5개</p><pre className="mt-2 whitespace-pre-wrap text-xs">{preview.goodsKeys.slice(-5).join("\n") || "-"}</pre></div>
      </div>
      <button type="button" disabled={busy || preview.validCount === 0} onClick={() => void savePrepared()} className="mt-4 rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">Bulk 준비 작업 저장</button>
    </div>}

    <div className="mt-7">
      <h3 className="font-bold">최근 작업</h3>
      <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">생성시간</th><th className="p-2">상태</th><th className="p-2">입력 방식</th><th className="p-2">유효 상품 수</th><th className="p-2">총 청크</th><th className="p-2">작업번호</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id} className="border-t"><td className="p-2">{new Date(job.created_at).toLocaleString("ko-KR")}</td><td className="p-2">{labelStatus(job.status)}</td><td className="p-2">{labelSource(job.input_source)}</td><td className="p-2">{job.valid_count}</td><td className="p-2">{job.total_chunk_count}</td><td className="p-2"><button type="button" className="font-mono text-xs text-blue-700 underline" onClick={() => void loadDetail(job.id)}>{job.id}</button></td></tr>)}</tbody></table></div>
    </div>

    {detail && <div className="mt-7 rounded-xl border border-slate-300 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-lg font-bold">저장된 Bulk 작업</h3><p className="mt-1 text-sm font-bold text-blue-900">작업 상태: {labelStatus(detail.job.status)}</p></div>
        <button type="button" disabled={busy || normalBusy} onClick={() => void loadDetail(detail.job.id)} className="rounded border px-3 py-2 text-sm font-bold disabled:opacity-50">상태 다시 불러오기</button>
      </div>

      {autoManaged && <p className="mt-4 rounded-lg border border-blue-300 bg-blue-50 p-3 font-semibold text-blue-900">이 작업은 서버 자동 실행이 진행을 관리합니다. 이 화면의 수동 카나리·일반 진행 버튼과 브라우저 직렬 루프는 비활성화됩니다. 현재 청크 후 일시중지, 직렬 실행 재개, 실패 상품 제한 재실행은 계속 사용할 수 있습니다.</p>}
      {detail.job.automation_stop_reason && <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-900">자동 실행 중단 사유: {detail.job.automation_stop_reason}</p>}

      <dl className="mt-4 grid gap-3 sm:grid-cols-4">{[
        ["작업번호", detail.job.id],
        ["원본 행 수", detail.job.original_count],
        ["유효 goods_key 수", detail.job.valid_count],
        ["중복 제거 수", detail.job.duplicate_count],
        ["invalid 제거 수", detail.job.invalid_count],
        ["카나리 상품 수", detail.job.canary_size ?? Math.min(detail.job.valid_count, 10)],
        ["일반 청크 크기", detail.job.normal_chunk_size ?? 50],
        ["일반 청크 수", detail.normal_chunk_count],
        ["재시도 라운드", `${detail.job.retry_round ?? 0}/${detail.job.max_retry_rounds ?? 2}`],
        ["성공 상품 수", detail.item_status_counts.succeeded],
        ["실패 상품 수", detail.item_status_counts.failed],
        ["대기 상품 수", detail.item_status_counts.pending],
        ["진행률", `${successPercent}%`],
      ].map(([label, value]) => <div key={String(label)} className="rounded bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="break-all font-bold">{value}</dd></div>)}</dl>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">goods_key 첫 20개</p><pre className="mt-2 whitespace-pre-wrap text-xs">{detail.first_goods_keys.join("\n") || "-"}</pre></div>
        <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">goods_key 마지막 5개</p><pre className="mt-2 whitespace-pre-wrap text-xs">{detail.last_goods_keys.join("\n") || "-"}</pre></div>
      </div>

      {!autoManaged && detail.job.status === "prepared" && <div className="mt-5 rounded-lg border-2 border-red-300 bg-red-50 p-4"><h4 className="font-bold text-red-950">카나리 실제 실행</h4><p className="mt-2 text-sm text-red-900">카나리만 실제 실행합니다. 일반 청크는 자동 실행되지 않습니다.</p><button type="button" disabled={busy} onClick={() => void runCanary()} className="mt-3 rounded bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50">카나리 가격설정 실행</button></div>}

      {!autoManaged && (["canary_running", "dispatch_uncertain"].includes(detail.job.status)) && <div className="mt-5 rounded-lg border border-blue-300 bg-blue-50 p-4"><h4 className="font-bold text-blue-950">카나리 결과 확인</h4><p className="mt-2 text-sm text-blue-900">GitHub Actions가 끝난 뒤 결과를 확인합니다. 새 실행은 만들지 않습니다.</p><button type="button" disabled={busy} onClick={() => void checkCanary()} className="mt-3 rounded bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">카나리 결과 확인</button></div>}

      {!autoManaged && detail.job.status === "canary_succeeded" && detail.normal_chunk_count === 0 && <p className="mt-5 rounded-lg bg-emerald-50 p-4 font-bold text-emerald-900">카나리만 포함된 작업이 완료되었습니다.</p>}

      {!autoManaged && detail.job.status === "canary_succeeded" && detail.normal_chunk_count > 0 && <div className="mt-5 rounded-lg border-2 border-red-300 bg-red-50 p-4"><h4 className="font-bold text-red-950">일반 상품 직렬 실행 승인</h4><p className="mt-2 text-sm text-red-900">카나리 성공 후에만 활성화됩니다. 한 번에 한 청크만 실행하며 실패 또는 불확실 상태에서 자동 중단됩니다.</p><button type="button" disabled={busy} onClick={() => void approveNormal()} className="mt-3 rounded bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50">일반 상품 직렬 실행 승인</button></div>}

      {(detail.job.status === "dispatch_uncertain" && canary?.status === "dispatch_uncertain") && <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-900">카나리 전송 여부 확인 중입니다. 새 실행을 만들지 않고 기존 request_id의 결과만 확인합니다.</p>}
      {(detail.job.status === "dispatch_uncertain" && detail.current_active_chunk?.chunk_type === "normal") && <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-900">일반 청크 전송 여부 확인 중입니다. 새 실행을 만들지 않고 기존 request_id의 결과만 확인합니다.</p>}
      {(detail.job.status === "dispatch_uncertain" && detail.current_active_chunk?.chunk_type === "retry") && <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-900">재시도 청크 전송 여부 확인 중입니다. 새 실행을 만들지 않고 기존 request_id의 결과만 확인합니다.</p>}

      {detail.failed_goods_key_count > 0 && <div className="mt-5 rounded-lg border border-red-300 bg-red-50 p-4"><div className="flex flex-wrap items-center gap-3"><h4 className="font-bold text-red-950">실패 상품 {detail.failed_goods_key_count}개</h4><button type="button" disabled={busy} onClick={() => void copyFailed()} className="rounded bg-slate-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">실패 goods_key 전체 복사</button></div><p className="mt-2 text-sm text-red-900">화면에는 최대 {detail.failed_preview_limit}개 미리보기만 표시합니다. 복사 버튼은 실패 상품 전체를 가져옵니다.</p><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-xs">{detail.failed_goods_keys_preview.join("\n")}</pre></div>}

      {retryAllowed && <div className="mt-5 rounded-lg border-2 border-red-400 bg-red-50 p-4"><h4 className="font-bold text-red-950">실패 상품 {detail.failed_goods_key_count}개만 재실행 승인</h4><p className="mt-2 text-sm text-red-900">이미 성공한 상품은 다시 실행하지 않습니다. 실패 범위가 명확한 경우에만 최대 2회 허용합니다.</p><button type="button" disabled={busy} onClick={() => void approveRetry()} className="mt-3 rounded bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50">실패 상품 {detail.failed_goods_key_count}개만 재실행 승인</button></div>}
      {retryLimitReached && detail.failed_goods_key_count > 0 && <p className="mt-4 rounded-lg bg-amber-50 p-3 font-bold text-amber-900">최대 재시도 횟수에 도달했습니다. 자동 재시도하지 않습니다.</p>}

      <div className="mt-5 flex flex-wrap gap-3">
        {pauseAllowed && <button type="button" disabled={busy} onClick={() => void control("pause")} className="rounded bg-amber-700 px-4 py-2 font-bold text-white disabled:opacity-50">현재 청크 완료 후 일시중지</button>}
        {resumeAllowed && <button type="button" disabled={busy} onClick={() => void control("resume")} className="rounded bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">직렬 실행 재개</button>}
      </div>

      <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">청크</th><th className="p-2">구분</th><th className="p-2">상품 수</th><th className="p-2">상태</th><th className="p-2">request_id</th></tr></thead><tbody>{detail.chunks.map((chunk) => <tr key={`${chunk.chunk_index}-${chunk.chunk_type}-${chunk.retry_round ?? 0}`} className="border-t"><td className="p-2">{chunk.chunk_index}</td><td className="p-2">{chunk.chunk_type}</td><td className="p-2">{chunk.goods_key_count}</td><td className="p-2">{labelChunkStatus(chunk.status)}</td><td className="p-2 font-mono text-xs">{chunk.request_id ?? "-"}</td></tr>)}</tbody></table></div>
    </div>}
  </section>;
}
