"use client";

import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
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

const STORAGE_KEY = "shoplingPriceModifySimpleAutoJobId";
const ACTIVE_STATUSES = new Set([
  "prepared",
  "canary_dispatching",
  "canary_running",
  "canary_succeeded",
  "normal_running",
  "retry_running",
  "dispatch_uncertain",
]);
const FAILED_STATUSES = new Set(["canary_failed", "normal_failed", "retry_failed"]);

type Selection = { label: string; result: ShoplingPriceBulkInputResult };
type Job = {
  id: string;
  status: string;
  valid_count: number;
  duplicate_count: number;
  invalid_count: number;
  canary_size: number;
  total_chunk_count: number;
  automation_mode?: string;
  automation_stop_reason?: string | null;
  automation_finished_at?: string | null;
  archived_at?: string | null;
  pause_requested?: boolean;
  retry_round?: number;
  max_retry_rounds?: number;
  retry_scope_known?: boolean;
};
type Chunk = { chunk_type: string; status: string; chunk_index: number };
type Detail = {
  job: Job;
  chunks: Chunk[];
  item_status_counts: { pending: number; succeeded: number; failed: number };
  normal_chunk_count: number;
  failed_goods_key_count: number;
};

type Step = { title: string; description: string };
const STEPS: Step[] = [
  { title: "1. 입력 확인", description: "상품번호와 제외 항목을 확인합니다." },
  { title: "2. 첫 10개 시험", description: "작은 수량으로 먼저 안전하게 확인합니다." },
  { title: "3. 나머지 자동 실행", description: "50개씩 차례로 변경합니다." },
  { title: "4. 완료", description: "성공·실패 결과를 저장합니다." },
];

function friendlyMessage(value: string) {
  return value
    .replaceAll("goods_key", "상품번호")
    .replaceAll("Bulk", "대량 작업")
    .replaceAll("bulk", "대량 작업")
    .replaceAll("canary", "첫 10개 시험")
    .replaceAll("chunk", "실행 묶음")
    .replaceAll("invalid", "잘못된 번호");
}

function simpleStatus(detail: Detail) {
  const { job } = detail;
  if (job.status === "normal_succeeded" || (job.status === "canary_succeeded" && detail.normal_chunk_count === 0)) {
    return "모든 상품의 가격 변경이 완료되었습니다.";
  }
  if (job.automation_stop_reason) return friendlyMessage(job.automation_stop_reason);
  if (FAILED_STATUSES.has(job.status)) {
    return detail.failed_goods_key_count > 0
      ? `실패 상품 ${detail.failed_goods_key_count.toLocaleString("ko-KR")}개가 있어 자동으로 멈췄습니다.`
      : "결과를 안전하게 확정할 수 없어 자동으로 멈췄습니다.";
  }
  if (job.status === "dispatch_uncertain") return "전송 상태를 확인하고 있습니다. 중복 방지를 위해 새로 실행하지 않습니다.";
  if (["normal_paused", "retry_paused"].includes(job.status)) return "자동 실행이 일시중지되어 있습니다.";
  if (job.pause_requested) return "현재 실행 묶음이 끝난 뒤 멈춥니다.";
  if (["canary_dispatching", "canary_running", "prepared"].includes(job.status)) return "첫 10개 상품을 확인하고 있습니다.";
  if (job.status === "canary_succeeded") return "첫 10개가 성공했습니다. 나머지 상품을 준비하고 있습니다.";
  if (job.status === "retry_running") return "실패 상품만 다시 실행하고 있습니다.";
  if (job.status === "normal_running") {
    const completed = detail.chunks.filter((chunk) => chunk.chunk_type === "normal" && ["succeeded", "recovered"].includes(chunk.status)).length;
    return `50개씩 자동으로 변경 중입니다. ${completed}/${detail.normal_chunk_count}묶음 완료`;
  }
  return "작업 상태를 확인하고 있습니다.";
}

function currentStep(detail: Detail | null) {
  if (!detail) return 1;
  if (detail.job.status === "normal_succeeded" || (detail.job.status === "canary_succeeded" && detail.normal_chunk_count === 0)) return 4;
  if (["prepared", "canary_dispatching", "canary_running", "canary_failed"].includes(detail.job.status)) return 2;
  return 3;
}

function isUnfinishedAutoJob(detail: Detail | null) {
  return Boolean(
    detail
      && detail.job.automation_mode === "auto"
      && !detail.job.automation_finished_at
      && !detail.job.archived_at,
  );
}

export function ShoplingPriceModifySimpleAutoRunner() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState("");

  const clearError = useCallback(() => { setError(""); setDiagnostic(""); }, []);
  const handleError = useCallback((caught: unknown, fallback: string, operation: string) => {
    if (caught instanceof ShoplingPriceBulkApiError) {
      setError(friendlyMessage(caught.message));
      setDiagnostic(caught.diagnosticText);
      return;
    }
    const message = friendlyMessage(caught instanceof Error ? caught.message : fallback);
    setError(message);
    setDiagnostic(JSON.stringify({ timestamp: new Date().toISOString(), operation, error: message }, null, 2));
  }, []);

  const loadDetail = useCallback(async (jobId: string) => {
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(jobId)}`,
        undefined,
        "simple_auto.detail",
      );
      const next = body as unknown as Detail;
      setDetail(next);
      localStorage.setItem(STORAGE_KEY, jobId);
      const url = new URL(window.location.href);
      url.searchParams.set("bulkJobId", jobId);
      window.history.replaceState(null, "", url);
    } catch (caught) {
      handleError(caught, "작업 상태를 불러오지 못했습니다.", "simple_auto.detail");
    }
  }, [handleError]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const queryId = new URLSearchParams(window.location.search).get("bulkJobId");
      const recentId = localStorage.getItem(STORAGE_KEY);
      const target = queryId ?? recentId;
      if (target) void loadDetail(target);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDetail]);

  useEffect(() => {
    if (!detail
      || detail.job.automation_mode !== "auto"
      || detail.job.automation_finished_at
      || detail.job.automation_stop_reason
      || !ACTIVE_STATUSES.has(detail.job.status)) return;
    const timer = window.setTimeout(() => void loadDetail(detail.job.id), 15_000);
    return () => window.clearTimeout(timer);
  }, [detail, loadDetail]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelection(null);
    setReading(true);
    clearError();
    try {
      setSelection({ label: file.name, result: await parseShoplingPriceBulkFile(file) });
    } catch (caught) {
      handleError(caught, "파일을 읽을 수 없습니다.", "simple_auto.file");
    } finally {
      setReading(false);
    }
  };

  const onPaste = (value: string) => {
    setSelection(null);
    clearError();
    try {
      setSelection({ label: "직접 붙여넣기", result: parseShoplingPriceBulkPaste(value) });
    } catch (caught) {
      handleError(caught, "상품번호를 확인할 수 없습니다.", "simple_auto.paste");
    }
  };

  const start = async () => {
    if (!selection || selection.result.validCount === 0 || busy || isUnfinishedAutoJob(detail)) return;
    const result = selection.result;
    const confirmed = window.confirm(
      `실제 상품 ${result.validCount.toLocaleString("ko-KR")}개의 가격을 변경합니다.\n\n` +
      "• 현재 저장된 기본 가격정책과 쇼핑몰별 정책을 적용합니다.\n" +
      "• 먼저 10개를 시험하고, 모두 성공하면 나머지를 50개씩 자동 처리합니다.\n" +
      "• 브라우저를 닫아도 서버에서 계속 진행합니다.\n" +
      "• 실패하거나 전송 상태가 불확실하면 즉시 멈춥니다.\n\n" +
      "계속하시겠습니까?",
    );
    if (!confirmed) return;

    setBusy(true);
    clearError();
    setNotice("");
    try {
      const body = await requestShoplingPriceBulkJson(
        "/api/shopling-price-modify/bulk/auto-jobs",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            confirmation: "CONFIRM_ONE_CLICK_AUTO_PRICE_CHANGE",
            input_source: result.source,
            goods_keys: result.goodsKeys,
            original_count: result.originalCount,
            duplicate_count: result.duplicateCount,
            invalid_count: result.invalidCount,
          }),
        },
        "simple_auto.create",
      );
      const jobId = typeof body.id === "string" ? body.id : "";
      if (!jobId) throw new Error("작업번호를 받지 못했습니다.");
      const message = friendlyMessage(typeof body.message === "string" ? body.message : "자동 가격 변경을 시작했습니다.");
      if (body.outcome === "stopped") setError(message);
      else setNotice(message);
      await loadDetail(jobId);
    } catch (caught) {
      handleError(caught, "자동 가격 변경을 시작하지 못했습니다.", "simple_auto.create");
    } finally {
      setBusy(false);
    }
  };

  const control = async (action: "pause" | "resume") => {
    if (!detail || busy) return;
    const label = action === "pause" ? "현재 실행 묶음이 끝난 뒤 멈춥니다." : "남은 상품 자동 실행을 계속합니다.";
    if (!window.confirm(`${label}\n계속하시겠습니까?`)) return;
    setBusy(true);
    clearError();
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/control/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation: action === "pause" ? "CONFIRM_BULK_PAUSE" : "CONFIRM_BULK_RESUME" }),
        },
        `simple_auto.${action}`,
      );
      setNotice(friendlyMessage(String(body.message ?? label)));
      await loadDetail(detail.job.id);
    } catch (caught) {
      handleError(caught, "실행 상태를 변경하지 못했습니다.", `simple_auto.${action}`);
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!detail || busy || detail.failed_goods_key_count === 0) return;
    if (!window.confirm(`실패 상품 ${detail.failed_goods_key_count}개만 다시 실행합니다.\n이미 성공한 상품은 다시 실행하지 않습니다.\n계속하시겠습니까?`)) return;
    setBusy(true);
    clearError();
    try {
      const body = await requestShoplingPriceBulkJson(
        `/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/retry/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation: "CONFIRM_FAILED_GOODS_RETRY" }),
        },
        "simple_auto.retry",
      );
      setNotice(friendlyMessage(String(body.message ?? "실패 상품만 다시 실행합니다.")));
      await loadDetail(detail.job.id);
    } catch (caught) {
      handleError(caught, "실패 상품을 다시 실행하지 못했습니다.", "simple_auto.retry");
    } finally {
      setBusy(false);
    }
  };

  const step = currentStep(detail);
  const preview = selection?.result;
  const retryAllowed = detail
    ? FAILED_STATUSES.has(detail.job.status)
      && detail.failed_goods_key_count > 0
      && detail.job.retry_scope_known !== false
      && (detail.job.retry_round ?? 0) < (detail.job.max_retry_rounds ?? 2)
    : false;
  const unfinishedAutoExists = isUnfinishedAutoJob(detail);
  const completed = detail?.item_status_counts.succeeded ?? 0;
  const failed = detail?.item_status_counts.failed ?? 0;
  const total = detail?.job.valid_count ?? preview?.validCount ?? 0;
  const progress = total > 0 ? Math.floor((completed + failed) * 100 / total) : 0;
  const status = useMemo(() => detail ? simpleStatus(detail) : "상품번호를 넣고 실행 전 내용을 확인하세요.", [detail]);
  const resultAvailable = detail && (
    detail.job.status === "normal_succeeded"
    || (detail.job.status === "canary_succeeded" && detail.normal_chunk_count === 0)
    || FAILED_STATUSES.has(detail.job.status)
    || Boolean(detail.job.automation_stop_reason)
  );

  return <div className="space-y-6">
    <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-950">상품번호 넣기</h2>
          <p className="mt-2 text-sm text-slate-600">엑셀·CSV를 선택하거나 상품번호를 붙여넣으세요. 쉼표, 공백, 줄바꿈이 섞여 있어도 자동으로 구분합니다.</p>
        </div>
        <Link href="/shopling-price-modify-runner/advanced" className="text-sm font-semibold text-slate-500 underline">고급 관리 열기</Link>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="rounded-xl border p-4">
          <span className="font-bold">엑셀·CSV 선택</span>
          <input type="file" accept=".xlsx,.csv" onChange={onFile} className="mt-3 block w-full" />
          <span className="mt-2 block text-xs text-slate-500">첫 줄에는 시스템 양식명 goods_key, 둘째 줄부터 상품번호를 넣습니다.</span>
        </label>
        <label className="rounded-xl border p-4">
          <span className="font-bold">직접 붙여넣기</span>
          <textarea onChange={(event) => onPaste(event.target.value)} className="mt-3 min-h-36 w-full rounded-lg border p-3 font-mono text-sm" placeholder="예: 119947, 119833 또는 줄바꿈으로 입력" />
        </label>
      </div>
      {reading && <p className="mt-3 text-sm">파일을 확인하고 있습니다.</p>}
      {error && <ShoplingPriceModifyBulkErrorPanel summary={error} diagnostic={diagnostic} />}
      {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 font-bold text-emerald-800">{notice}</p>}

      {preview && <div className="mt-5 rounded-xl bg-slate-50 p-5">
        <h3 className="font-bold">실행 전 확인</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-4">
          {[
            ["변경할 상품", preview.validCount],
            ["제외된 중복", preview.duplicateCount],
            ["잘못된 번호", preview.invalidCount],
            ["실행 묶음", plannedShoplingPriceBulkChunkCount(preview.validCount)],
          ].map(([label, value]) => <div key={label} className="rounded-lg bg-white p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-xl font-black">{Number(value).toLocaleString("ko-KR")}</dd></div>)}
        </dl>
        <p className="mt-4 text-sm font-semibold text-blue-900">안전 방식: 첫 10개 확인 후 나머지를 50개씩 자동 실행합니다.</p>
        <button type="button" disabled={busy || preview.validCount === 0 || unfinishedAutoExists} onClick={() => void start()} className="mt-5 w-full rounded-xl bg-blue-700 px-6 py-4 text-lg font-black text-white shadow-sm disabled:opacity-50">
          {busy ? "시작 준비 중..." : unfinishedAutoExists ? "현재 자동 변경 작업 미완료" : "전체 가격 자동 변경 시작"}
        </button>
        {unfinishedAutoExists && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-center text-sm font-semibold text-amber-900">기존 자동 작업을 먼저 계속 실행하거나 실패 상품만 다시 실행하세요. 더 이상 진행하지 않을 작업은 고급 관리에서 보관한 뒤 새 작업을 시작할 수 있습니다.</p>}
        {!unfinishedAutoExists && <p className="mt-3 text-center text-sm text-slate-600">먼저 10개를 시험 실행합니다. 모두 성공하면 나머지를 자동 처리하며, 실패하거나 전송 상태가 불확실하면 즉시 멈춥니다.</p>}
        <details className="mt-4 text-sm text-slate-600"><summary className="cursor-pointer font-semibold">상세 보기</summary><p className="mt-2">입력 방식: {selection.label} · 원본 {preview.originalCount.toLocaleString("ko-KR")}개 · 예상 쇼핑몰 수정 행 {(preview.validCount * 24).toLocaleString("ko-KR")}개</p></details>
      </div>}
    </section>

    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black">진행 상황</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {STEPS.map((item, index) => {
          const number = index + 1;
          const active = number === step;
          const done = number < step;
          return <div key={item.title} className={`rounded-xl border p-4 ${active ? "border-blue-500 bg-blue-50" : done ? "border-emerald-300 bg-emerald-50" : "bg-slate-50"}`}>
            <p className="font-black">{done ? "✓ " : ""}{item.title}</p>
            <p className="mt-1 text-xs text-slate-600">{item.description}</p>
          </div>;
        })}
      </div>
      <div className="mt-5 rounded-xl bg-slate-950 p-5 text-white">
        <p className="text-lg font-black">{status}</p>
        {detail && <>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-700"><div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, progress)}%` }} /></div>
          <p className="mt-2 text-sm">전체 {total.toLocaleString("ko-KR")}개 · 성공 {completed.toLocaleString("ko-KR")}개 · 실패 {failed.toLocaleString("ko-KR")}개 · {progress}%</p>
        </>}
      </div>

      {detail && <div className="mt-4 flex flex-wrap gap-3">
        {(["normal_running", "retry_running"].includes(detail.job.status)) && <button type="button" disabled={busy} onClick={() => void control("pause")} className="rounded-lg bg-amber-700 px-4 py-3 font-bold text-white disabled:opacity-50">현재 묶음 후 멈추기</button>}
        {(["normal_paused", "retry_paused"].includes(detail.job.status)) && <button type="button" disabled={busy} onClick={() => void control("resume")} className="rounded-lg bg-blue-700 px-4 py-3 font-bold text-white disabled:opacity-50">계속 실행</button>}
        {retryAllowed && <button type="button" disabled={busy} onClick={() => void retry()} className="rounded-lg bg-red-700 px-4 py-3 font-bold text-white disabled:opacity-50">실패 상품만 다시 실행</button>}
        {resultAvailable && <a href={`/api/shopling-price-modify/bulk/jobs/${encodeURIComponent(detail.job.id)}/report?format=csv`} className="rounded-lg bg-emerald-700 px-4 py-3 font-bold text-white">결과 파일 받기</a>}
        <button type="button" disabled={busy} onClick={() => void loadDetail(detail.job.id)} className="rounded-lg border px-4 py-3 font-bold disabled:opacity-50">상태 다시 확인</button>
      </div>}

      {detail && <details className="mt-5 rounded-xl border p-4 text-sm"><summary className="cursor-pointer font-semibold">작업 상세 보기</summary><dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <div><dt className="text-slate-500">작업번호</dt><dd className="break-all font-mono">{detail.job.id}</dd></div>
        <div><dt className="text-slate-500">현재 상태</dt><dd>{detail.job.status}</dd></div>
        <div><dt className="text-slate-500">자동 실행</dt><dd>{detail.job.automation_mode === "auto" ? "사용" : "수동"}</dd></div>
      </dl></details>}
    </section>
  </div>;
}
