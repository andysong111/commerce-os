"use client";

import { useMemo, useState } from "react";

type PlanRow = {
  goods_key?: string;
  adjustment_bps?: number;
  current?: { sell_price?: number; option_amounts?: number[]; option_signature?: string };
  target?: { sell_price?: number; option_amounts?: number[] };
};

type PlanResponse = {
  status?: string;
  message?: string;
  summary?: { status?: string; rows?: PlanRow[]; errors?: unknown[] };
};

type BatchResultRow = {
  position?: number;
  goods_key?: string;
  status?: string;
  requires_option_write?: boolean;
  current?: { sell_price?: number; option_amounts?: number[] };
  target?: { sell_price?: number; option_amounts?: number[] };
  mall_api_success_count?: number;
  mall_api_failure_count?: number;
  product_readback_ok?: boolean;
  option_target_verified?: boolean;
  option_signature_preserved?: boolean;
  error?: string;
  message?: string;
};

type BatchSummary = {
  status?: string;
  requested_count?: number;
  success_count?: number;
  failed_count?: number;
  not_executed_count?: number;
  fail_stop_used?: boolean;
  automatic_retry_used?: boolean;
  rows?: BatchResultRow[];
  error?: string;
};

type BatchResponse = {
  status?: string;
  message?: string;
  requestId?: string;
  githubActionsUrl?: string;
  runUrl?: string;
  summary?: BatchSummary;
};

const PLAN_REQUEST_STORAGE_KEY = "shoplingPriceAdjustment.currentPlanRequestId";
const BATCH_REQUEST_STORAGE_KEY = "shoplingPriceAdjustment.currentBatchCanaryRequestId";
const REQUIRED_BATCH_SIZE = 10;

const won = (value: number | undefined) => Number.isFinite(value) ? `${Number(value).toLocaleString("ko-KR")}원` : "-";
const amounts = (values: number[] | undefined) => Array.isArray(values) && values.length > 0 ? values.map((value) => value.toLocaleString("ko-KR")).join(", ") : "없음";

function sameNumberArray(left: number[] | undefined, right: number[] | undefined) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function validPlanRow(row: PlanRow) {
  return typeof row.goods_key === "string"
    && /^\d+$/.test(row.goods_key)
    && typeof row.adjustment_bps === "number"
    && Number.isInteger(row.adjustment_bps)
    && typeof row.current?.sell_price === "number"
    && Number.isSafeInteger(row.current.sell_price)
    && row.current.sell_price > 0
    && typeof row.current?.option_signature === "string"
    && /^[0-9a-f]{64}$/i.test(row.current.option_signature)
    && typeof row.target?.sell_price === "number"
    && Number.isSafeInteger(row.target.sell_price)
    && row.target.sell_price > 0;
}

function buildBatchInput(rows: PlanRow[]) {
  if (rows.length !== REQUIRED_BATCH_SIZE) throw new Error(`10개 실제 카나리는 정확히 ${REQUIRED_BATCH_SIZE}개 상품이 필요합니다.`);
  return rows.map((row) => {
    if (!validPlanRow(row)) throw new Error(`읽기 전용 계획에 실행할 수 없는 상품이 있습니다: ${row.goods_key ?? "-"}`);
    return {
      goods_key: row.goods_key!,
      adjustment_bps: row.adjustment_bps!,
      expected_current_sell_price: row.current!.sell_price!,
      expected_option_signature: row.current!.option_signature!,
      requires_option_write: !sameNumberArray(row.current?.option_amounts, row.target?.option_amounts),
    };
  });
}

export function ShoplingPriceAdjustmentBatchCanaryPanel() {
  const [planRequestId, setPlanRequestId] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem(PLAN_REQUEST_STORAGE_KEY) ?? "");
  const [planLoading, setPlanLoading] = useState(false);
  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchFetching, setBatchFetching] = useState(false);
  const [batchRequestId, setBatchRequestId] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem(BATCH_REQUEST_STORAGE_KEY) ?? "");
  const [batchResponse, setBatchResponse] = useState<BatchResponse | null>(null);
  const [error, setError] = useState("");

  const planRows = useMemo(() => {
    if (planResponse?.summary?.status !== "success") return [];
    const rows = Array.isArray(planResponse.summary.rows) ? planResponse.summary.rows : [];
    return rows.filter(validPlanRow).slice(0, REQUIRED_BATCH_SIZE);
  }, [planResponse]);
  const batchReady = planRows.length === REQUIRED_BATCH_SIZE;

  const loadLatestPlan = async () => {
    const latest = typeof window === "undefined" ? planRequestId : localStorage.getItem(PLAN_REQUEST_STORAGE_KEY) ?? planRequestId;
    if (!latest) {
      setError("먼저 위의 읽기 전용 카나리에서 정확히 10개 상품을 조회하세요.");
      return;
    }
    setPlanRequestId(latest);
    setPlanLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/shopling-price-adjustment/plan/result?request_id=${encodeURIComponent(latest)}`, { cache: "no-store" });
      const body = await response.json() as PlanResponse;
      if (!response.ok || body.status === "error") throw new Error(body.message ?? `읽기 전용 결과 조회 실패 status=${response.status}`);
      setPlanResponse(body);
      setBatchResponse(null);
      setBatchRequestId("");
      localStorage.removeItem(BATCH_REQUEST_STORAGE_KEY);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "읽기 전용 결과를 가져오지 못했습니다.");
    } finally {
      setPlanLoading(false);
    }
  };

  const runBatch = async () => {
    if (!batchReady || batchRunning) return;
    setError("");
    let input;
    try { input = buildBatchInput(planRows); }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : "10개 카나리 입력이 올바르지 않습니다.");
      return;
    }
    const optionCount = input.filter((row) => row.requires_option_write).length;
    if (!window.confirm(
      `샵플링 상품 ${input.length}개의 가격을 실제로 순차 변경합니다.\n\n` +
      `기본가격 전용: ${input.length - optionCount}개\n` +
      `옵션 추가금 포함: ${optionCount}개\n` +
      `각 상품마다 기본가격·24개 쇼핑몰 가격을 반영합니다.\n\n` +
      `자동 재시도는 없으며 첫 실패 시 남은 상품은 실행하지 않습니다. 계속하시겠습니까?`,
    )) return;
    setBatchRunning(true);
    setBatchResponse(null);
    try {
      const response = await fetch("/api/shopling-price-adjustment/batch-canary/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const body = await response.json() as BatchResponse;
      if (!response.ok || body.status === "error") throw new Error(body.message ?? `10개 실제 카나리 요청 실패 status=${response.status}`);
      const requestId = body.requestId ?? "";
      if (!requestId) throw new Error("10개 카나리 요청 추적 ID가 없습니다.");
      setBatchRequestId(requestId);
      localStorage.setItem(BATCH_REQUEST_STORAGE_KEY, requestId);
      setBatchResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "10개 카나리 요청 중 오류가 발생했습니다.");
    } finally {
      setBatchRunning(false);
    }
  };

  const fetchBatchResult = async () => {
    if (!batchRequestId || batchFetching) return;
    setBatchFetching(true);
    setError("");
    try {
      const response = await fetch(`/api/shopling-price-adjustment/batch-canary/result?request_id=${encodeURIComponent(batchRequestId)}`, { cache: "no-store" });
      const body = await response.json() as BatchResponse;
      if (!response.ok || body.status === "error") throw new Error(body.message ?? `10개 카나리 결과 조회 실패 status=${response.status}`);
      setBatchResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "10개 카나리 결과를 가져오지 못했습니다.");
    } finally {
      setBatchFetching(false);
    }
  };

  return <section className="mt-8 rounded-2xl border-2 border-fuchsia-300 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-slate-950">10개 상품 실제 가격 변경 카나리</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">읽기 전용으로 검증한 정확히 10개 상품을 한 개씩 직렬 실행합니다. 옵션 추가금 변경 상품과 일반 상품을 자동 분리하며 첫 실패 시 즉시 중단합니다.</p>
      </div>
      <span className="rounded-full bg-fuchsia-100 px-3 py-1 text-sm font-bold text-fuchsia-900">10개 실제 변경</span>
    </div>

    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" disabled={planLoading} onClick={() => void loadLatestPlan()} className="rounded-lg bg-fuchsia-700 px-4 py-3 font-bold text-white disabled:opacity-50">{planLoading ? "계획 확인 중..." : "최근 10개 읽기 전용 계획 불러오기"}</button>
      <button type="button" disabled={!batchReady || batchRunning || batchResponse?.summary?.status === "success"} onClick={() => void runBatch()} className="rounded-lg bg-red-700 px-4 py-3 font-bold text-white disabled:opacity-50">{batchRunning ? "10개 실제 변경 요청 중..." : "이 10개 실제 가격 변경 테스트"}</button>
      <button type="button" disabled={!batchRequestId || batchFetching} onClick={() => void fetchBatchResult()} className="rounded-lg bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">{batchFetching ? "결과 확인 중..." : "10개 변경 결과 가져오기"}</button>
    </div>

    {planRequestId && <p className="mt-4 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs">plan_request_id: {planRequestId}</p>}
    {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>}
    {planResponse && !batchReady && <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm font-semibold text-amber-900">현재 읽기 전용 계획에서 실행 가능한 상품은 {planRows.length}개입니다. 새 상품 10개를 한 번에 조회한 뒤 다시 불러오세요. 이미 단일 테스트한 상품은 다시 넣지 마세요.</p>}

    {batchReady && <div className="mt-5 overflow-x-auto rounded-xl border border-fuchsia-200">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead><tr className="bg-fuchsia-50"><th className="p-2">순번</th><th className="p-2">goods_key</th><th className="p-2">조정률</th><th className="p-2">판매가</th><th className="p-2">옵션 추가금</th><th className="p-2">실행 모드</th></tr></thead>
        <tbody>{planRows.map((row, index) => {
          const optionWrite = !sameNumberArray(row.current?.option_amounts, row.target?.option_amounts);
          return <tr className="border-t" key={row.goods_key}><td className="p-2">{index + 1}</td><td className="p-2 font-mono">{row.goods_key}</td><td className="p-2">{Number(row.adjustment_bps ?? 0) / 100}%</td><td className="p-2">{won(row.current?.sell_price)} → <strong>{won(row.target?.sell_price)}</strong></td><td className="p-2">{amounts(row.current?.option_amounts)} → {amounts(row.target?.option_amounts)}</td><td className="p-2 font-bold">{optionWrite ? "기본+옵션" : "기본가격"}</td></tr>;
        })}</tbody>
      </table>
    </div>}

    {batchRequestId && <p className="mt-4 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs">batch_canary_request_id: {batchRequestId}</p>}
    {batchResponse?.message && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900">{batchResponse.message}</p>}
    {batchResponse?.githubActionsUrl && <a href={batchResponse.githubActionsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-blue-700 underline">10개 카나리 GitHub Actions 열기</a>}
    {batchResponse?.runUrl && <a href={batchResponse.runUrl} target="_blank" rel="noreferrer" className="ml-4 mt-3 inline-block text-sm font-semibold text-blue-700 underline">10개 카나리 완료 실행 열기</a>}
    {batchResponse?.summary && <BatchResult summary={batchResponse.summary} />}
  </section>;
}

function BatchResult({ summary }: { summary: BatchSummary }) {
  const success = summary.status === "success";
  const rows = Array.isArray(summary.rows) ? summary.rows : [];
  return <div className={`mt-5 rounded-xl border p-5 ${success ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
    <h3 className="font-bold">10개 실제 가격 변경 결과</h3>
    <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Cell label="상태" value={summary.status ?? "-"} />
      <Cell label="요청" value={String(summary.requested_count ?? 0)} />
      <Cell label="성공" value={String(summary.success_count ?? 0)} />
      <Cell label="실패" value={String(summary.failed_count ?? 0)} />
      <Cell label="미실행" value={String(summary.not_executed_count ?? 0)} />
      <Cell label="자동 재시도" value={summary.automatic_retry_used ? "사용" : "없음"} />
    </dl>
    <div className="mt-5 overflow-x-auto rounded-lg border bg-white">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead><tr className="bg-slate-50"><th className="p-2">순번</th><th className="p-2">goods_key</th><th className="p-2">모드</th><th className="p-2">상태</th><th className="p-2">판매가</th><th className="p-2">쇼핑몰 성공/실패</th><th className="p-2">재조회</th><th className="p-2">메시지</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr className="border-t" key={`${row.goods_key ?? "row"}-${index}`}><td className="p-2">{row.position ?? index + 1}</td><td className="p-2 font-mono">{row.goods_key ?? "-"}</td><td className="p-2">{row.requires_option_write ? "기본+옵션" : "기본가격"}</td><td className="p-2 font-bold">{row.status ?? "-"}</td><td className="p-2">{won(row.current?.sell_price)} → {won(row.target?.sell_price)}</td><td className="p-2">{row.mall_api_success_count ?? 0} / {row.mall_api_failure_count ?? 0}</td><td className="p-2">{row.status === "not_executed" ? "미실행" : row.product_readback_ok ? "일치" : "불일치"}</td><td className="p-2">{row.error ?? row.message ?? "-"}</td></tr>)}</tbody>
      </table>
    </div>
    {summary.error && <p className="mt-4 rounded-lg bg-white p-3 text-sm font-semibold text-red-900">{summary.error}</p>}
    {success && <p className="mt-4 font-bold text-emerald-900">10개 직렬 실제 변경 카나리를 통과했습니다. 같은 계획은 다시 실행하지 마세요.</p>}
    {!success && summary.fail_stop_used && <p className="mt-4 font-bold text-red-900">첫 실패에서 실행을 중단했습니다. 성공 상품은 유지하고 실패 원인을 확인한 뒤 새 계획으로 진행해야 합니다.</p>}
  </div>;
}

function Cell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-bold text-slate-950">{value}</dd></div>;
}
