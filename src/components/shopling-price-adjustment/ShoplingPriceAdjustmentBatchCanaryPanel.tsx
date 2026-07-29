"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseShoplingPriceAdjustmentPaste,
} from "@/lib/shoplingPriceAdjustmentInput";
import {
  parseStoredShoplingPriceAdjustmentBulkSelection,
  SHOPLING_PRICE_ADJUSTMENT_BULK_SELECTION_STORAGE_KEY,
} from "@/lib/shoplingPriceAdjustmentBulkSelection";
import {
  requestShoplingPriceAdjustmentApi,
  SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT,
} from "@/lib/shoplingPriceAdjustmentApiClient";

const INPUT_TEXTAREA_LABEL = "goods_key와 조정률 직접 붙여넣기";
const JOB_STORAGE_KEY = "shoplingPriceAdjustment.currentBulkJobId";
const MAX_BULK_SIZE = 10_000;
const AUTO_INTERVAL_MS = 4_000;
const LOGIN_URL =
  "/login?force=1&error=login_required&next=%2Fshopling-price-adjustment-runner";

type JobRow = {
  id?: string;
  status?: string;
  valid_count?: number;
  canary_size?: number;
  chunk_size?: number;
  total_chunk_count?: number;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
};

type ChunkRow = {
  id?: string;
  chunk_index?: number;
  chunk_type?: string;
  goods_key_count?: number;
  status?: string;
  last_error?: string | null;
};

type JobDetail = {
  job?: JobRow;
  chunks?: ChunkRow[];
  item_status_counts?: Record<string, number>;
  chunk_status_counts?: Record<string, number>;
  current_chunk?: ChunkRow | null;
  error?: string;
};

type AdvanceResponse = {
  status?: string;
  jobStatus?: string;
  chunkIndex?: number;
  message?: string;
  error?: string;
};

type ApiFailure = {
  error?: string;
  code?: string;
  stage?: string;
  detail?: string | null;
  diagnostic_id?: string;
  active_job?: JobRow | null;
};

type PreparedBulkInput = ReturnType<typeof parseShoplingPriceAdjustmentPaste>;

function samePreparedInput(left: PreparedBulkInput, right: PreparedBulkInput) {
  return left.rows.length === right.rows.length
    && left.rows.every((row, index) => {
      const other = right.rows[index];
      return row.goodsKey === other?.goodsKey && row.adjustmentBps === other.adjustmentBps;
    });
}

function getCurrentRows() {
  const storedSelection = parseStoredShoplingPriceAdjustmentBulkSelection(
    localStorage.getItem(
      SHOPLING_PRICE_ADJUSTMENT_BULK_SELECTION_STORAGE_KEY,
    ),
  );
  if (storedSelection) {
    if (storedSelection.result.validCount > MAX_BULK_SIZE) {
      throw new Error(
        `최대 ${MAX_BULK_SIZE.toLocaleString("ko-KR")}개까지 실행할 수 있습니다.`,
      );
    }
    return storedSelection.result;
  }

  const textarea = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${INPUT_TEXTAREA_LABEL}"]`);
  if (!textarea) throw new Error("위 입력 영역에서 일괄 또는 개별 설정으로 상품 목록을 반영하세요.");
  const parsed = parseShoplingPriceAdjustmentPaste(textarea.value);
  if (parsed.validCount === 0) throw new Error("실행할 goods_key와 조정률을 입력하세요.");
  if (parsed.invalidCount > 0) throw new Error(`잘못된 입력 ${parsed.invalidCount}개를 먼저 수정하세요.`);
  if (parsed.validCount > MAX_BULK_SIZE) throw new Error(`최대 ${MAX_BULK_SIZE.toLocaleString("ko-KR")}개까지 실행할 수 있습니다.`);
  return parsed;
}

function apiFailureMessage(
  body: ApiFailure,
  status: number,
  fallback: string,
) {
  const context = [
    body.code,
    body.stage,
    body.detail,
    body.diagnostic_id ? `진단번호 ${body.diagnostic_id}` : null,
  ].filter(Boolean);
  return `${body.error ?? `${fallback} status=${status}`}${
    context.length ? ` · ${context.join(" · ")}` : ""
  }`;
}

function isTerminal(status: string | undefined) {
  return ["succeeded", "failed", "dispatch_uncertain", "cancelled"].includes(status ?? "");
}

function blocksNewJob(status: string | undefined) {
  return ["prepared", "running", "paused", "dispatch_uncertain"].includes(status ?? "");
}

function labelStatus(status: string | undefined) {
  const labels: Record<string, string> = {
    prepared: "실행 대기",
    running: "자동 진행 중",
    paused: "일시중지",
    succeeded: "완료",
    failed: "실패",
    dispatch_uncertain: "전송상태 확인 필요",
    cancelled: "취소",
    pending: "대기",
    planning: "현재가·옵션 조회 중",
    ready: "가격 변경 준비 완료",
    executing: "실제 가격 변경 중",
  };
  return labels[status ?? ""] ?? status ?? "-";
}

export function ShoplingPriceAdjustmentBatchCanaryPanel() {
  const [jobId, setJobId] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem(JOB_STORAGE_KEY) ?? "");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [checkingSession, setCheckingSession] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preparedInput, setPreparedInput] = useState<PreparedBulkInput | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const [jobMissing, setJobMissing] = useState(false);
  const tickingRef = useRef(false);

  useEffect(() => {
    const requireLogin = () => setLoginRequired(true);
    window.addEventListener(
      SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT,
      requireLogin,
    );
    return () => {
      window.removeEventListener(
        SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT,
        requireLogin,
      );
    };
  }, []);

  const loadDetail = useCallback(async (targetJobId = jobId) => {
    if (!targetJobId) return null;
    setLoading(true);
    try {
      const response = await requestShoplingPriceAdjustmentApi(
        `/api/shopling-price-adjustment/bulk/jobs/${encodeURIComponent(targetJobId)}`,
        {
          cache: "no-store",
          credentials: "same-origin",
        },
      );
      const body = await response.json() as JobDetail & ApiFailure;
      if (!response.ok || body.error) {
        if (response.status === 401) setLoginRequired(true);
        if (response.status === 404) setJobMissing(true);
        throw new Error(
          apiFailureMessage(body, response.status, "작업 조회 실패"),
        );
      }
      setJobMissing(false);
      setDetail(body);
      if (isTerminal(body.job?.status) || body.job?.status === "paused") setAutoRunning(false);
      return body;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "작업 상태를 조회하지 못했습니다.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    const timeoutId = window.setTimeout(() => {
      void loadDetail(jobId);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [jobId, loadDetail]);

  const prepareCreate = async () => {
    if (creating || checkingSession || autoRunning || (jobId && !jobMissing)) {
      setError("기존 Bulk 작업을 먼저 완료하거나 상태를 확인하세요.");
      return;
    }
    setError("");
    setMessage("");
    setLoginRequired(false);
    let parsed: PreparedBulkInput;
    try {
      parsed = getCurrentRows();
    } catch (caught) {
      setPreparedInput(null);
      setError(caught instanceof Error ? caught.message : "현재 입력을 읽을 수 없습니다.");
      return;
    }

    setCheckingSession(true);
    try {
      const response = await requestShoplingPriceAdjustmentApi(
        "/api/shopling-price-adjustment/bulk/jobs",
        {
          cache: "no-store",
          credentials: "same-origin",
        },
      );
      const body = await response.json() as {
        jobs?: JobRow[];
      } & ApiFailure;
      if (!response.ok) {
        if (response.status === 401) setLoginRequired(true);
        throw new Error(
          apiFailureMessage(body, response.status, "로그인 상태 확인 실패"),
        );
      }
      const existingJob = body.active_job
        ?? body.jobs?.find((candidate) =>
          candidate.id && blocksNewJob(candidate.status)
        );
      if (existingJob?.id) {
        setJobId(existingJob.id);
        setJobMissing(false);
        localStorage.setItem(JOB_STORAGE_KEY, existingJob.id);
        setPreparedInput(null);
        setMessage(
          `기존 Bulk 작업(${labelStatus(existingJob.status)})을 복원했습니다. 새 작업을 만들지 않고 기존 작업 상태를 확인하세요.`,
        );
        await loadDetail(existingJob.id);
        return;
      }
      setPreparedInput(parsed);
    } catch (caught) {
      setPreparedInput(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "로그인 상태를 확인하지 못했습니다.",
      );
    } finally {
      setCheckingSession(false);
    }
  };

  const createAndStart = async () => {
    if (creating || !preparedInput || (jobId && !jobMissing)) return;
    setError("");
    setMessage("");
    setLoginRequired(false);
    let parsed: PreparedBulkInput;
    try {
      parsed = getCurrentRows();
    } catch (caught) {
      setPreparedInput(null);
      setError(caught instanceof Error ? caught.message : "현재 입력을 다시 읽을 수 없습니다.");
      return;
    }
    if (!samePreparedInput(preparedInput, parsed)) {
      setPreparedInput(null);
      setError("입력 상품 또는 조정률이 변경되었습니다. 현재 입력으로 다시 확인하세요.");
      return;
    }

    setCreating(true);
    try {
      const createResponse = await requestShoplingPriceAdjustmentApi("/api/shopling-price-adjustment/bulk/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          inputSource: parsed.source,
          rows: parsed.rows.map((row) => ({ goodsKey: row.goodsKey, adjustmentBps: row.adjustmentBps })),
          originalCount: parsed.originalCount,
          duplicateCount: parsed.duplicateCount,
          invalidCount: parsed.invalidCount,
        }),
      });
      const created = await createResponse.json() as {
        id?: string;
      } & ApiFailure;
      if (!createResponse.ok || !created.id) {
        if (createResponse.status === 401) setLoginRequired(true);
        const existingJob = created.active_job;
        if (
          existingJob?.id
          && blocksNewJob(existingJob.status)
        ) {
          const existingJobId = existingJob.id;
          setJobId(existingJobId);
          setJobMissing(false);
          localStorage.setItem(JOB_STORAGE_KEY, existingJobId);
          setPreparedInput(null);
          setMessage(
            `기존 Bulk 작업(${labelStatus(existingJob.status)})을 복원했습니다. 새 작업은 생성하지 않았습니다.`,
          );
          await loadDetail(existingJobId);
          return;
        }
        throw new Error(
          apiFailureMessage(
            created,
            createResponse.status,
            "Bulk 작업 저장 실패",
          ),
        );
      }
      const id = created.id;
      setJobId(id);
      setJobMissing(false);
      localStorage.setItem(JOB_STORAGE_KEY, id);
      // The persistent job now exists. Close the create confirmation before
      // starting so a start/auth failure cannot create a duplicate job.
      setPreparedInput(null);

      const startResponse = await requestShoplingPriceAdjustmentApi(
        `/api/shopling-price-adjustment/bulk/jobs/${encodeURIComponent(id)}/start`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const started = await startResponse.json() as ApiFailure;
      if (!startResponse.ok) {
        if (startResponse.status === 401) setLoginRequired(true);
        throw new Error(
          apiFailureMessage(
            started,
            startResponse.status,
            "Bulk 작업 시작 실패",
          ),
        );
      }
      setMessage(`${parsed.validCount.toLocaleString("ko-KR")}개 상품의 Bulk 자동 진행을 시작했습니다.`);
      setAutoRunning(true);
      await loadDetail(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bulk 작업을 시작하지 못했습니다.");
    } finally {
      setCreating(false);
    }
  };

  const advanceOnce = useCallback(async () => {
    if (!jobId || tickingRef.current) return;
    tickingRef.current = true;
    try {
      const response = await requestShoplingPriceAdjustmentApi(`/api/shopling-price-adjustment/bulk/jobs/${encodeURIComponent(jobId)}/advance`, { method: "POST" });
      const body = await response.json() as AdvanceResponse;
      if (!response.ok || body.error) throw new Error(body.error ?? body.message ?? `자동 진행 실패 status=${response.status}`);
      if (body.message) setMessage(body.message);
      const next = await loadDetail(jobId);
      if (isTerminal(next?.job?.status) || next?.job?.status === "paused") setAutoRunning(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "자동 진행 중 오류가 발생했습니다.");
      setAutoRunning(false);
    } finally {
      tickingRef.current = false;
    }
  }, [jobId, loadDetail]);

  useEffect(() => {
    if (!autoRunning || !jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      if (cancelled) return;
      await advanceOnce();
      if (!cancelled) timer = setTimeout(loop, AUTO_INTERVAL_MS);
    };
    void loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [advanceOnce, autoRunning, jobId]);

  const resume = async () => {
    if (!jobId) return;
    setError("");
    if (detail?.job?.status === "paused" || detail?.job?.status === "prepared") {
      const response = await requestShoplingPriceAdjustmentApi(`/api/shopling-price-adjustment/bulk/jobs/${encodeURIComponent(jobId)}/start`, { method: "POST" });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setError(body.error ?? `재개 실패 status=${response.status}`);
        return;
      }
    }
    setMessage("Bulk 자동 진행을 재개했습니다.");
    setAutoRunning(true);
  };

  const pause = async () => {
    if (!jobId || pausing) return;
    setPausing(true);
    setError("");
    try {
      const response = await requestShoplingPriceAdjustmentApi(`/api/shopling-price-adjustment/bulk/jobs/${encodeURIComponent(jobId)}/pause`, { method: "POST" });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error ?? `일시중지 실패 status=${response.status}`);
      setMessage(body.message ?? "현재 진행 단계가 끝난 뒤 일시중지합니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "일시중지를 요청하지 못했습니다.");
    } finally {
      setPausing(false);
    }
  };

  const clearJob = () => {
    setAutoRunning(false);
    setJobId("");
    setJobMissing(false);
    setDetail(null);
    setPreparedInput(null);
    setLoginRequired(false);
    setMessage("");
    setError("");
    localStorage.removeItem(JOB_STORAGE_KEY);
    localStorage.removeItem(
      SHOPLING_PRICE_ADJUSTMENT_BULK_SELECTION_STORAGE_KEY,
    );
    window.location.reload();
  };

  const job = detail?.job;
  const counts = detail?.item_status_counts ?? {};
  const succeeded = counts.succeeded ?? 0;
  const total = job?.valid_count ?? 0;
  const progress = total > 0 ? Math.min(100, Math.round((succeeded / total) * 10_000) / 100) : 0;
  const chunks = Array.isArray(detail?.chunks) ? detail!.chunks! : [];
  const succeededChunks = chunks.filter((chunk) => chunk.status === "succeeded").length;
  const existingJobBlocksCreate = Boolean(jobId && !jobMissing);
  const canPrepareNewJob = !autoRunning && (
    !jobId
    || jobMissing
    || Boolean(job && !blocksNewJob(job.status))
  );

  return <section className="mt-8 rounded-2xl border-2 border-fuchsia-300 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-slate-950">최대 10,000개 Bulk 실제 가격 변경</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">위 일괄 또는 개별 설정의 goods_key·조정률을 작업으로 저장한 뒤 첫 10개 시험, 이후 50개 청크로 자동 진행합니다. 옵션 추가금 변경 여부는 자동 판단합니다.</p>
      </div>
      <span className="rounded-full bg-fuchsia-100 px-3 py-1 text-sm font-bold text-fuchsia-900">1만개 Bulk</span>
    </div>

    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" disabled={creating || checkingSession || autoRunning || Boolean(preparedInput) || existingJobBlocksCreate} onClick={() => void prepareCreate()} className="rounded-lg bg-fuchsia-700 px-4 py-3 font-bold text-white disabled:opacity-50">{creating ? "작업 저장·시작 중..." : checkingSession ? "로그인 상태 확인 중..." : "현재 입력으로 Bulk 작업 시작"}</button>
      <button type="button" disabled={!jobId || autoRunning || isTerminal(job?.status)} onClick={() => void resume()} className="rounded-lg bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-50">자동 진행 재개</button>
      <button type="button" disabled={!jobId || job?.status !== "running" || pausing} onClick={() => void pause()} className="rounded-lg bg-amber-600 px-4 py-3 font-bold text-white disabled:opacity-50">{pausing ? "중지 요청 중..." : "현재 단계 후 일시중지"}</button>
      <button type="button" disabled={!jobId || loading} onClick={() => void loadDetail()} className="rounded-lg bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">{loading ? "조회 중..." : "상태 새로고침"}</button>
      <button type="button" disabled={!canPrepareNewJob} onClick={clearJob} className="rounded-lg border border-slate-300 bg-white px-4 py-3 font-bold text-slate-700 disabled:opacity-50">새 작업 준비</button>
    </div>

    {preparedInput && <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
      <p className="font-bold text-amber-950">실제 실행 최종 확인</p>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        {preparedInput.validCount.toLocaleString("ko-KR")}개 상품 · 첫 {Math.min(10, preparedInput.validCount).toLocaleString("ko-KR")}개 시험 · 총 {(1 + Math.ceil(Math.max(preparedInput.validCount - 10, 0) / 50)).toLocaleString("ko-KR")}개 청크
      </p>
      <p className="mt-1 text-sm text-amber-900">각 청크는 현재가·옵션을 재검증하고 첫 실패 또는 전송 불확실 시 전체 진행을 중단합니다.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={creating} onClick={() => void createAndStart()} className="rounded-lg bg-red-700 px-4 py-3 font-bold text-white disabled:opacity-50">{creating ? "작업 저장·시작 중..." : "확인 후 실제 Bulk 시작"}</button>
        <button type="button" disabled={creating} onClick={() => setPreparedInput(null)} className="rounded-lg border border-amber-400 bg-white px-4 py-3 font-bold text-amber-900 disabled:opacity-50">취소</button>
      </div>
    </div>}

    {jobId && <p className="mt-4 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs">job_id: {jobId}</p>}
    {message && <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">{message}</p>}
    {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>}
    {loginRequired && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">
      <p>입력 목록은 이 브라우저에 보존했습니다. 다시 로그인한 뒤 같은 목록을 재확인하세요.</p>
      <a href={LOGIN_URL} className="mt-2 inline-block rounded-lg bg-amber-700 px-4 py-2 text-white">로그인 다시 하기</a>
    </div>}

    {job && <div className="mt-5 rounded-xl border border-fuchsia-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-fuchsia-950">Bulk 작업 진행상황</h3>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${job.status === "succeeded" ? "bg-emerald-100 text-emerald-900" : job.status === "failed" || job.status === "dispatch_uncertain" ? "bg-red-100 text-red-900" : "bg-blue-100 text-blue-900"}`}>{labelStatus(job.status)}</span>
      </div>
      <div className="mt-4 h-4 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>
      <p className="mt-2 text-sm font-semibold text-slate-700">{succeeded.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")}개 완료 · {progress.toLocaleString("ko-KR")}%</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Cell label="전체 상품" value={total.toLocaleString("ko-KR")} />
        <Cell label="성공" value={succeeded.toLocaleString("ko-KR")} />
        <Cell label="실패" value={(counts.failed ?? 0).toLocaleString("ko-KR")} />
        <Cell label="미실행" value={(counts.not_executed ?? 0).toLocaleString("ko-KR")} />
        <Cell label="완료 청크" value={`${succeededChunks.toLocaleString("ko-KR")} / ${(job.total_chunk_count ?? 0).toLocaleString("ko-KR")}`} />
        <Cell label="현재 단계" value={labelStatus(detail?.current_chunk?.status ?? job.status)} />
      </dl>
      {detail?.current_chunk && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">현재 청크 #{Number(detail.current_chunk.chunk_index ?? 0).toLocaleString("ko-KR")} · {Number(detail.current_chunk.goods_key_count ?? 0).toLocaleString("ko-KR")}개 · {labelStatus(detail.current_chunk.status)}</p>}
      {job.last_error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-900">{job.last_error}</p>}
      {autoRunning && <p className="mt-4 font-bold text-blue-800">브라우저가 자동으로 다음 단계를 진행하고 있습니다. 탭을 닫아도 작업 상태는 저장되며 다시 열어 재개할 수 있습니다.</p>}
      {job.status === "succeeded" && <p className="mt-4 font-bold text-emerald-900">전체 가격 변경이 완료됐습니다. 같은 goods_key 목록을 다시 실행하지 마세요.</p>}
    </div>}
  </section>;
}

function Cell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-bold text-slate-950">{value}</dd></div>;
}
