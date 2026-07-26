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
};
type StatusCounts = { pending: number; succeeded: number; failed: number };
type Detail = { job: Job; chunks: Chunk[]; first_goods_keys: string[]; last_goods_keys: string[]; item_status_counts: StatusCounts; chunk_status_counts: StatusCounts & { dispatching: number; running: number; dispatch_uncertain: number }; normal_chunk_count: number; current_active_chunk: Chunk | null };

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
  normal_failed: "일반 청크 실패 · 자동 실행 중단",
  cancelled: "취소됨",
};

const CHUNK_STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  dispatching: "전송 중",
  running: "실행 중",
  succeeded: "성공",
  failed: "실패",
  dispatch_uncertain: "전송 여부 불확실",
};

const labelStatus = (status: string) => STATUS_LABELS[status] ?? status;
const labelChunkStatus = (status: string) => CHUNK_STATUS_LABELS[status] ?? status;
const labelSource = (source: string) => source === "paste" ? "직접 붙여넣기" : source.toUpperCase();

export function ShoplingPriceModifyBulkInputPreview() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [notice, setNotice] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const normalBusyRef = useRef(false);

  const clearError = useCallback(() => {
    setError("");
    setErrorDetail("");
  }, []);

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
      failure_type: "client_error",
      error: message,
    }, null, 2));
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const body = await requestShoplingPriceBulkJson(
        "/api/shopling-price-modify/bulk/jobs",
        undefined,
        "bulk_jobs.list",
      );
      setJobs(Array.isArray(body.jobs) ? body.jobs as Job[] : []);
    } catch (caught) {
      handleError(caught, "Bulk 작업 조회에 실패했습니다.", "bulk_jobs.list");
    }
  }, [handleError]);

  const loadDetail = useCallback(async (jobId: string) => {
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(jobId)}`,
        undefined,
        "bulk_jobs.detail",
      );
      setDetail(body as unknown as Detail);
      const url = new URL(window.location.href);
      url.searchParams.set("bulkJobId", jobId);
      window.history.replaceState(null, "", url);
      localStorage.setItem(STORAGE_KEY, jobId);
    } catch (caught) {
      handleError(caught, "Bulk 작업 조회에 실패했습니다.", "bulk_jobs.detail");
    }
  }, [handleError]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadJobs();
      const queryId = new URLSearchParams(window.location.search).get("bulkJobId");
      const recentId = localStorage.getItem(STORAGE_KEY);
      const targetId = queryId ?? recentId;
      if (targetId) void loadDetail(targetId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDetail, loadJobs]);

  const refresh = useCallback(async (jobId: string) => {
    await Promise.all([loadDetail(jobId), loadJobs()]);
  }, [loadDetail, loadJobs]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReading(true);
    clearError();
    try {
      setSelection({ label: file.name, result: await parseShoplingPriceBulkFile(file) });
    } catch (caught) {
      handleError(caught, "파일을 읽을 수 없습니다.", "bulk_input.file");
    } finally {
      setReading(false);
    }
  };

  const onPaste = (value: string) => {
    clearError();
    try {
      setSelection({ label: "직접 붙여넣기", result: parseShoplingPriceBulkPaste(value) });
    } catch (caught) {
      handleError(caught, "입력을 검사할 수 없습니다.", "bulk_input.paste");
    }
  };

  const save = async () => {
    if (!selection || saving) return;
    const result = selection.result;
    if (!window.confirm(
      `유효 ${result.validCount}개의 goods_key를 Bulk 준비 작업으로 저장합니다.\n` +
      `중복 ${result.duplicateCount}개와 invalid ${result.invalidCount}개는 제외됩니다.\n` +
      "이 단계에서는 가격이 변경되지 않습니다.\n계속하시겠습니까?",
    )) return;

    setSaving(true);
    clearError();
    setNotice("");
    try {
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
        "bulk_jobs.create",
      );
      const jobId = typeof body.id === "string" ? body.id : "";
      if (!jobId) throw new Error("Bulk 작업 저장 응답에 작업번호가 없습니다.");
      await refresh(jobId);
      setNotice("Bulk 준비 작업이 저장되었습니다. 가격은 아직 변경되지 않았습니다.");
    } catch (caught) {
      handleError(caught, "Bulk 작업 저장에 실패했습니다.", "bulk_jobs.create");
    } finally {
      setSaving(false);
    }
  };

  const runCanary = async () => {
    if (!detail || acting) return;
    const canaryCount = detail.job.canary_size ?? Math.min(detail.job.valid_count, 10);
    if (!window.confirm(
      `카나리 ${canaryCount}개 상품의 기본가격과 24개 쇼핑몰별 가격을 실제로 변경합니다.\n` +
      "일반 청크는 자동 실행되지 않습니다.\n" +
      "이 실행은 실제 운영 데이터에 반영됩니다. 계속하시겠습니까?",
    )) return;

    setActing(true);
    clearError();
    setNotice("");
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/canary/dispatch`,
        { method: "POST" },
        "bulk_canary.dispatch",
      );
      setNotice(typeof body.message === "string" ? body.message : "카나리 실행 요청을 처리했습니다.");
      await refresh(detail.job.id);
    } catch (caught) {
      handleError(caught, "카나리 실행 요청에 실패했습니다.", "bulk_canary.dispatch");
    } finally {
      setActing(false);
    }
  };

  const checkCanary = async () => {
    if (!detail || acting) return;
    setActing(true);
    clearError();
    setNotice("");
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/canary/result`,
        { method: "POST" },
        "bulk_canary.result",
      );
      setNotice(typeof body.message === "string" ? body.message : "카나리 결과를 확인했습니다.");
      await refresh(detail.job.id);
    } catch (caught) {
      handleError(caught, "카나리 결과 확인에 실패했습니다.", "bulk_canary.result");
    } finally {
      setActing(false);
    }
  };

  const approveNormal = async () => {
    if (!detail || acting || normalBusyRef.current) return;
    const count = Math.max(0, detail.job.valid_count - (detail.job.canary_size ?? 0));
    if (!window.confirm(`카나리 가격이 정상인지 샵플링에서 확인했습니까?\n\n일반 상품 ${count}개를 최대 50개씩 한 청크만 순차 실행합니다.\n각 청크의 성공 결과가 확인된 후에만 다음 청크가 실행됩니다.\n실패 또는 전송 여부 불확실 상태에서는 즉시 중단됩니다.\n\n이 작업은 실제 상품 가격을 변경합니다.\n계속하시겠습니까?`)) return;
    normalBusyRef.current = true; setActing(true); clearError();
    try {
      const body = await requestShoplingPriceBulkJson(`/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/normal/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "CONFIRM_NORMAL_BULK_EXECUTION" }) }, "bulk_normal.approve");
      setNotice(String(body.message ?? "일반 청크 실행이 승인되었습니다.")); await refresh(detail.job.id);
    } catch (caught) { handleError(caught, "일반 청크 승인에 실패했습니다.", "bulk_normal.approve"); }
    finally { normalBusyRef.current = false; setActing(false); }
  };

  useEffect(() => {
    if (!detail || detail.job.status !== "normal_running") return;
    const jobId = detail.job.id;
    const active = detail.current_active_chunk;
    const delay = active ? 12000 : 1200;
    const timer = window.setTimeout(async () => {
      if (normalBusyRef.current) return;
      normalBusyRef.current = true;
      try {
        const endpoint = active ? "result" : "advance";
        const body = await requestShoplingPriceBulkJson(`/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(jobId)}/normal/${endpoint}`, { method: "POST" }, `bulk_normal.${endpoint}`);
        if (body.status !== "pending") setNotice(String(body.message ?? "일반 청크 상태가 갱신되었습니다."));
        await refresh(jobId);
      } catch (caught) { handleError(caught, "일반 청크 직렬 실행이 중단되었습니다.", "bulk_normal.serial"); await refresh(jobId); }
      finally { normalBusyRef.current = false; }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [detail, handleError, refresh]);

  return <div className="space-y-8">
    <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-950">대량 가격설정 입력 준비</h2>
      <p className="mt-2 text-sm text-slate-600">Bulk 실행 전 goods_key 형식을 검사합니다. 준비 작업 저장만으로는 가격을 수정하지 않습니다.</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border p-4">
          <h3 className="font-bold">엑셀·CSV 업로드</h3>
          <input aria-label="파일 업로드" type="file" accept=".xlsx,.csv" onChange={onFile} className="mt-3 block w-full" />
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <strong>고정 양식</strong>
            <ul className="list-disc pl-5"><li>첫 시트 A열만 사용</li><li>A1: goods_key</li><li>A2부터 상품번호</li><li>B열 이후 데이터 금지</li></ul>
          </div>
        </div>
        <label className="rounded-xl border p-4 font-bold">
          직접 붙여넣기
          <textarea onChange={(event) => onPaste(event.target.value)} className="mt-3 min-h-40 w-full rounded-lg border p-2 font-mono text-sm" />
          <span className="mt-2 block text-sm font-normal text-slate-600">쉼표, 공백, 탭, 줄바꿈을 사용할 수 있습니다.</span>
        </label>
      </div>
      {reading && <p className="mt-4">파일을 검사하고 있습니다.</p>}
      {error && <ShoplingPriceModifyBulkErrorPanel summary={error} diagnostic={errorDetail} />}
      {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 font-bold text-emerald-800">{notice}</p>}
      {selection
        ? <Preview selection={selection} saving={saving} save={save} />
        : <p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">파일을 업로드하거나 goods_key를 붙여넣으면 실행 전 미리보기가 표시됩니다.</p>}
    </section>
    <SavedJobs jobs={jobs} detail={detail} acting={acting} select={loadDetail} runCanary={runCanary} checkCanary={checkCanary} approveNormal={approveNormal} />
  </div>;
}

function Preview({ selection, saving, save }: { selection: Selection; saving: boolean; save: () => void }) {
  const { result } = selection;
  const rows = [
    ["입력 방식", labelSource(result.source)], ["원본 항목 수", result.originalCount], ["유효 goods_key 수", result.validCount],
    ["중복 제거 수", result.duplicateCount], ["invalid 수", result.invalidCount], ["최종 대상 수", result.validCount],
    ["예상 쇼핑몰 가격 수정 행 수", result.validCount * 24], ["카나리 크기", "최대 10"], ["일반 청크 크기", "최대 50"],
    ["예상 청크 수", plannedShoplingPriceBulkChunkCount(result.validCount)],
  ];
  const last = result.goodsKeys.length > 20 ? result.goodsKeys.slice(-5) : [];
  return <div className="mt-6 rounded-xl border border-emerald-200 p-5">
    <h3 className="font-bold">실행 전 미리보기</h3>
    <p className="mt-2 text-sm">{selection.label}</p>
    <dl className="mt-4 grid gap-2 sm:grid-cols-3">{rows.map(([key, value]) => <div className="rounded-lg bg-slate-50 p-3" key={key}><dt className="text-xs text-slate-500">{key}</dt><dd className="font-bold">{value}</dd></div>)}</dl>
    <div className="grid gap-4 lg:grid-cols-2"><PreviewList title="goods_key 첫 20개" values={result.goodsKeys.slice(0, 20)} />{last.length > 0 && <PreviewList title="goods_key 마지막 5개" values={last} />}</div>
    {result.goodsKeys.length > 25 && <p className="mt-2 text-xs text-slate-600">중간 {(result.goodsKeys.length - 25).toLocaleString("ko-KR")}개 항목은 생략했습니다.</p>}
    {result.invalidCount > 0 && <p className="mt-3 text-amber-800">invalid {result.invalidCount}개: {result.invalid.slice(0, 100).join(", ")}</p>}
    {result.validCount > 0 && <div className="mt-5">
      <p className="mb-3 font-semibold text-blue-900">이 단계에서는 입력 목록과 청크 계획만 서버에 저장합니다.<br />상품 가격은 아직 변경되지 않습니다.</p>
      <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-blue-700 px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? "저장 중..." : "Bulk 준비 작업 저장"}</button>
    </div>}
  </div>;
}

function SavedJobs({
  jobs,
  detail,
  acting,
  select,
  runCanary,
  checkCanary,
  approveNormal,
}: {
  jobs: Job[];
  detail: Detail | null;
  acting: boolean;
  select: (id: string) => Promise<void>;
  runCanary: () => Promise<void>;
  checkCanary: () => Promise<void>;
  approveNormal: () => Promise<void>;
}) {
  const canary = detail?.chunks.find((chunk) => chunk.chunk_index === 0 && chunk.chunk_type === "canary");
  const normal = detail?.chunks.filter((chunk) => chunk.chunk_type === "normal") ?? [];
  return <section className="rounded-2xl border bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold">저장된 Bulk 작업</h2>
    {detail && <div className="mt-5 rounded-xl border border-blue-200 p-5">
      <p className="rounded-lg bg-blue-50 p-3 font-bold text-blue-900">작업 상태: {labelStatus(detail.job.status)}</p>
      <dl className="mt-4 grid gap-2 sm:grid-cols-3">{[
        ["작업번호", detail.job.id], ["상태", labelStatus(detail.job.status)], ["입력 방식", labelSource(detail.job.input_source)],
        ["원본 항목 수", detail.job.original_count], ["유효 goods_key 수", detail.job.valid_count], ["중복 제외 수", detail.job.duplicate_count],
        ["invalid 제외 수", detail.job.invalid_count], ["카나리 상품 수", detail.job.canary_size ?? 0], ["normal chunk 수", detail.job.total_chunk_count - 1],
        ["총 chunk 수", detail.job.total_chunk_count], ["생성시간", new Date(detail.job.created_at).toLocaleString("ko-KR")], ["최근 갱신시간", new Date(detail.job.updated_at).toLocaleString("ko-KR")],
        ["성공 상품 수", detail.item_status_counts.succeeded], ["실패 상품 수", detail.item_status_counts.failed], ["대기 상품 수", detail.item_status_counts.pending],
        ["normal 성공 청크", normal.filter((chunk) => chunk.status === "succeeded").length], ["normal 실패 청크", normal.filter((chunk) => chunk.status === "failed").length], ["normal 대기 청크", normal.filter((chunk) => chunk.status === "pending").length],
        ["진행률", `${detail.job.valid_count ? Math.floor(detail.item_status_counts.succeeded * 100 / detail.job.valid_count) : 0}%`],
      ].map(([key, value]) => <div className="rounded bg-slate-50 p-3" key={key}><dt className="text-xs text-slate-500">{key}</dt><dd className="break-all font-semibold">{value}</dd></div>)}</dl>

      {detail.job.last_error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">마지막 오류: {detail.job.last_error}</p>}

      {detail.job.status === "prepared" && <div className="mt-5 rounded-xl border border-red-300 bg-red-50 p-4">
        <p className="font-bold text-red-900">다음 버튼은 카나리 상품의 실제 가격을 변경합니다.</p>
        <p className="mt-1 text-sm text-red-800">카나리만 실행하며 일반 청크는 자동으로 시작하지 않습니다.</p>
        <button type="button" disabled={acting} onClick={() => void runCanary()} className="mt-3 rounded-lg bg-red-700 px-5 py-3 font-bold text-white disabled:opacity-50">{acting ? "처리 중..." : `카나리 ${detail.job.canary_size ?? Math.min(detail.job.valid_count, 10)}개 실제 실행`}</button>
      </div>}

      {new Set(["canary_dispatching", "canary_running", "dispatch_uncertain"]).has(detail.job.status) && <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="font-bold text-amber-900">{detail.job.status === "dispatch_uncertain" ? "중복 실행 금지: 전송 여부가 불확실합니다." : "카나리 결과를 수동으로 확인하세요."}</p>
        <p className="mt-1 text-sm text-amber-800">결과 확인은 같은 request_id만 조회하며 새 실행을 만들지 않습니다.</p>
        <button type="button" disabled={acting || detail.job.status === "canary_dispatching"} onClick={() => void checkCanary()} className="mt-3 rounded-lg bg-amber-700 px-5 py-3 font-bold text-white disabled:opacity-50">{acting ? "확인 중..." : "카나리 결과 확인"}</button>
      </div>}

      {detail.job.status === "canary_succeeded" && detail.normal_chunk_count === 0 && <p className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-900">카나리만 포함된 작업이 완료되었습니다.</p>}
      {detail.job.status === "canary_succeeded" && detail.normal_chunk_count > 0 && <div className="mt-5 rounded-xl border-2 border-red-400 bg-red-50 p-5">
        <h3 className="text-lg font-bold text-red-950">일반 상품 직렬 실행 승인</h3>
        <ul className="mt-2 list-disc pl-5 text-sm text-red-900"><li>일반 상품 수: {detail.job.valid_count - (detail.job.canary_size ?? 0)}개</li><li>normal 청크 수: {detail.normal_chunk_count}개</li><li>청크당 최대 50개</li><li>한 번에 실행되는 청크 수: 1개</li><li>성공 확인 후 다음 청크 진행</li><li>실패 또는 불확실 상태에서 자동 중단</li></ul>
        <button type="button" disabled={acting} onClick={() => void approveNormal()} className="mt-4 rounded-lg bg-red-700 px-5 py-3 font-bold text-white disabled:opacity-50">일반 상품 {detail.job.valid_count - (detail.job.canary_size ?? 0)}개 직렬 실행 승인</button>
      </div>}
      {detail.job.status === "normal_running" && <div className="mt-5 rounded-xl border border-blue-400 bg-blue-50 p-4 text-blue-950"><p className="font-bold">Bulk 일반 청크 직렬 실행 중 — 한 번에 한 청크만 실행합니다.</p><p className="mt-1 text-sm">브라우저를 닫아도 시작된 GitHub Actions는 계속됩니다. 다음 청크 진행은 일시정지되며 다시 접속하면 저장된 상태부터 자동 재개됩니다.</p></div>}
      {detail.job.status === "normal_succeeded" && <p className="mt-5 rounded-xl border-2 border-emerald-500 bg-emerald-50 p-5 text-lg font-bold text-emerald-950">모든 상품의 가격설정 작업이 완료되었습니다.</p>}
      {detail.job.status === "normal_failed" && <p className="mt-5 rounded-xl border border-red-400 bg-red-50 p-4 font-bold text-red-950">일반 청크가 실패하여 자동 실행을 중단했습니다. 자동 재시도하지 않습니다.</p>}
      {detail.job.status === "canary_failed" && <p className="mt-5 rounded-xl border border-red-300 bg-red-50 p-4 font-bold text-red-900">카나리가 실패했습니다. 자동 재시도와 일반 청크 실행은 차단되어 있습니다.</p>}

      {canary && <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm">
        <h3 className="font-bold">카나리 청크</h3>
        <p className="mt-2">상태: {labelChunkStatus(canary.status)} · 상품 수: {canary.goods_key_count}</p>
        <p className="mt-1 break-all">request_id: {canary.request_id ?? "-"}</p>
        {canary.actions_url && <a className="mt-2 inline-block text-blue-700 underline" href={canary.actions_url} target="_blank" rel="noreferrer">GitHub Actions 열기</a>}
        {canary.last_error && <p className="mt-2 text-red-700">청크 오류: {canary.last_error}</p>}
      </div>}

      {detail.current_active_chunk && <div className="mt-4 rounded-xl bg-blue-50 p-4 text-sm"><h3 className="font-bold">현재 실행 청크</h3><p>chunk_index: {detail.current_active_chunk.chunk_index} · 상품 수: {detail.current_active_chunk.goods_key_count}</p><p className="break-all">request_id: {detail.current_active_chunk.request_id}</p>{detail.current_active_chunk.actions_url && <a className="text-blue-700 underline" href={detail.current_active_chunk.actions_url} target="_blank" rel="noreferrer">GitHub Actions 열기</a>}</div>}

      <div className="grid lg:grid-cols-2"><PreviewList title="goods_key 첫 20개" values={detail.first_goods_keys} /><PreviewList title="goods_key 마지막 5개" values={detail.last_goods_keys} /></div>
    </div>}

    <h3 className="mt-7 font-bold">최근 작업</h3>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["생성시간", "상태", "입력 방식", "유효 상품 수", "총 청크 수", "작업번호"].map((value) => <th className="p-2" key={value}>{value}</th>)}</tr></thead><tbody>{jobs.map((job) => <tr tabIndex={0} role="button" onClick={() => void select(job.id)} onKeyDown={(event) => { if (event.key === "Enter") void select(job.id); }} className="cursor-pointer border-t hover:bg-slate-50" key={job.id}><td className="p-2">{new Date(job.created_at).toLocaleString("ko-KR")}</td><td className="p-2">{labelStatus(job.status)}</td><td className="p-2">{labelSource(job.input_source)}</td><td className="p-2">{job.valid_count}</td><td className="p-2">{job.total_chunk_count}</td><td className="p-2 font-mono">{job.id}</td></tr>)}</tbody></table></div>
  </section>;
}

function PreviewList({ title, values }: { title: string; values: string[] }) {
  return <div className="mt-4 rounded-lg bg-slate-50 p-4"><h4 className="text-sm font-bold">{title}</h4><ol className="mt-2 list-decimal pl-6 font-mono text-sm">{values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ol></div>;
}
