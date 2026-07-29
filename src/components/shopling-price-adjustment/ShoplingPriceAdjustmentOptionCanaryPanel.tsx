"use client";

import { useMemo, useState } from "react";

type PricePlanRow = {
  goods_key?: string;
  adjustment_bps?: number;
  current?: { sell_price?: number; option_amounts?: number[]; option_signature?: string };
  target?: { sell_price?: number; consumer_price?: number; purchase_price?: number; option_amounts?: number[]; option_signature?: string };
  mall_row_count?: number;
};

type PlanResponse = {
  status?: string;
  message?: string;
  requestId?: string;
  runUrl?: string;
  summary?: { status?: string; rows?: PricePlanRow[]; errors?: Array<{ goods_key?: string; error?: string }> };
};

type OptionCanarySummary = {
  status?: string;
  goods_key?: string;
  current?: { sell_price?: number; option_amounts?: number[] };
  target?: { sell_price?: number; consumer_price?: number; purchase_price?: number; option_amounts?: number[] };
  product_api?: { status?: string; code?: string; msg?: string };
  mall_api_success_count?: number;
  mall_api_failure_count?: number;
  product_readback_ok?: boolean;
  option_amount_write_attempted?: boolean;
  option_structure_preserved?: boolean;
  option_target_verified?: boolean;
  verified?: { sell_price?: number; consumer_price?: number; purchase_price?: number; option_amounts?: number[] };
  error?: string;
};

type OptionCanaryResponse = {
  status?: string;
  message?: string;
  requestId?: string;
  githubActionsUrl?: string;
  runUrl?: string;
  summary?: OptionCanarySummary;
};

const PLAN_REQUEST_STORAGE_KEY = "shoplingPriceAdjustment.currentPlanRequestId";
const OPTION_CANARY_REQUEST_STORAGE_KEY = "shoplingPriceAdjustment.currentOptionCanaryRequestId";

const won = (value: number | undefined) => Number.isFinite(value) ? `${Number(value).toLocaleString("ko-KR")}원` : "-";
const amountText = (values: number[] | undefined) => Array.isArray(values) && values.length > 0 ? values.map((value) => `${value.toLocaleString("ko-KR")}원`).join(", ") : "없음";

function differentOptionAmounts(row: PricePlanRow) {
  const current = Array.isArray(row.current?.option_amounts) ? row.current?.option_amounts ?? [] : [];
  const target = Array.isArray(row.target?.option_amounts) ? row.target?.option_amounts ?? [] : [];
  return current.length > 0 && current.length === target.length && current.some((value, index) => value !== target[index]);
}

function buildOptionCanaryInput(row: PricePlanRow) {
  const goodsKey = row.goods_key;
  const adjustmentBps = row.adjustment_bps;
  const expectedSell = row.current?.sell_price;
  const optionSignature = row.current?.option_signature;
  if (typeof goodsKey !== "string" || !/^\d+$/.test(goodsKey)) throw new Error("옵션 카나리 goods_key가 없습니다.");
  if (typeof adjustmentBps !== "number" || !Number.isInteger(adjustmentBps)) throw new Error("옵션 카나리 조정률이 없습니다.");
  if (typeof expectedSell !== "number" || !Number.isSafeInteger(expectedSell) || expectedSell <= 0) throw new Error("읽기 전용 현재 판매가가 없습니다.");
  if (typeof optionSignature !== "string" || !/^[0-9a-f]{64}$/i.test(optionSignature)) throw new Error("읽기 전용 옵션 서명이 없습니다.");
  if (!differentOptionAmounts(row)) throw new Error("옵션 추가금이 실제로 변경되는 상품이 아닙니다.");
  return {
    goods_key: goodsKey,
    adjustment_bps: adjustmentBps,
    expected_current_sell_price: expectedSell,
    expected_option_signature: optionSignature,
  };
}

export function ShoplingPriceAdjustmentOptionCanaryPanel() {
  const [planRequestId, setPlanRequestId] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem(PLAN_REQUEST_STORAGE_KEY) ?? "");
  const [planLoading, setPlanLoading] = useState(false);
  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [canaryRunning, setCanaryRunning] = useState(false);
  const [canaryFetching, setCanaryFetching] = useState(false);
  const [canaryRequestId, setCanaryRequestId] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem(OPTION_CANARY_REQUEST_STORAGE_KEY) ?? "");
  const [canaryResponse, setCanaryResponse] = useState<OptionCanaryResponse | null>(null);
  const [error, setError] = useState("");

  const candidate = useMemo(() => {
    if (planResponse?.summary?.status !== "success") return null;
    const rows = Array.isArray(planResponse.summary.rows) ? planResponse.summary.rows : [];
    return rows.find((row) => differentOptionAmounts(row)) ?? null;
  }, [planResponse]);

  const loadLatestPlan = async () => {
    const latest = typeof window === "undefined" ? planRequestId : localStorage.getItem(PLAN_REQUEST_STORAGE_KEY) ?? planRequestId;
    if (!latest) {
      setError("먼저 위의 읽기 전용 카나리에서 옵션 추가금이 변하는 상품을 조회하세요.");
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
      setCanaryResponse(null);
      setCanaryRequestId("");
      localStorage.removeItem(OPTION_CANARY_REQUEST_STORAGE_KEY);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "읽기 전용 결과를 가져오지 못했습니다.");
    } finally {
      setPlanLoading(false);
    }
  };

  const runOptionCanary = async () => {
    if (!candidate || canaryRunning) return;
    setError("");
    let input;
    try { input = buildOptionCanaryInput(candidate); }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : "옵션 카나리 입력이 올바르지 않습니다.");
      return;
    }
    if (!window.confirm(
      `실제 샵플링 기본가격과 옵션 추가금을 변경합니다.\n\n` +
      `goods_key: ${input.goods_key}\n` +
      `기본 판매가: ${won(input.expected_current_sell_price)} → ${won(candidate.target?.sell_price)}\n` +
      `옵션 추가금: ${amountText(candidate.current?.option_amounts)} → ${amountText(candidate.target?.option_amounts)}\n` +
      `24개 쇼핑몰 가격정책도 함께 적용합니다.\n\n` +
      `옵션 상태·재고·바코드·자체관리코드는 변경하지 않습니다. 계속하시겠습니까?`,
    )) return;
    setCanaryRunning(true);
    setCanaryResponse(null);
    try {
      const response = await fetch("/api/shopling-price-adjustment/option-canary/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const body = await response.json() as OptionCanaryResponse;
      if (!response.ok || body.status === "error") throw new Error(body.message ?? `옵션 가격 카나리 요청 실패 status=${response.status}`);
      const requestId = body.requestId ?? "";
      if (!requestId) throw new Error("옵션 카나리 요청 추적 ID가 없습니다.");
      setCanaryRequestId(requestId);
      localStorage.setItem(OPTION_CANARY_REQUEST_STORAGE_KEY, requestId);
      setCanaryResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "옵션 카나리 요청 중 오류가 발생했습니다.");
    } finally {
      setCanaryRunning(false);
    }
  };

  const fetchOptionCanary = async () => {
    if (!canaryRequestId || canaryFetching) return;
    setCanaryFetching(true);
    setError("");
    try {
      const response = await fetch(`/api/shopling-price-adjustment/option-canary/result?request_id=${encodeURIComponent(canaryRequestId)}`, { cache: "no-store" });
      const body = await response.json() as OptionCanaryResponse;
      if (!response.ok || body.status === "error") throw new Error(body.message ?? `옵션 카나리 결과 조회 실패 status=${response.status}`);
      setCanaryResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "옵션 카나리 결과 조회 중 오류가 발생했습니다.");
    } finally {
      setCanaryFetching(false);
    }
  };

  return <section className="mt-8 rounded-2xl border-2 border-orange-300 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-slate-950">옵션 추가금 실제 변경 카나리</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">읽기 전용 결과에서 옵션 추가금이 실제로 변하는 첫 상품 1개를 선택해 기본가격·옵션 추가금·24개 쇼핑몰 가격을 검증합니다.</p>
      </div>
      <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-bold text-orange-900">실제 옵션가격 변경</span>
    </div>

    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" disabled={planLoading} onClick={() => void loadLatestPlan()} className="rounded-lg bg-orange-700 px-4 py-3 font-bold text-white disabled:opacity-50">{planLoading ? "계획 확인 중..." : "최근 읽기 전용 계획 불러오기"}</button>
      <button type="button" disabled={!candidate || canaryRunning} onClick={() => void runOptionCanary()} className="rounded-lg bg-red-700 px-4 py-3 font-bold text-white disabled:opacity-50">{canaryRunning ? "옵션 변경 요청 중..." : "이 1개 옵션가격 실제 변경 테스트"}</button>
      <button type="button" disabled={!canaryRequestId || canaryFetching} onClick={() => void fetchOptionCanary()} className="rounded-lg bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">{canaryFetching ? "결과 확인 중..." : "옵션 변경 결과 가져오기"}</button>
    </div>

    {planRequestId && <p className="mt-4 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs">plan_request_id: {planRequestId}</p>}
    {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>}
    {planResponse && !candidate && <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm font-semibold text-amber-900">이 읽기 전용 계획에는 옵션 추가금이 변하는 정상 상품이 없습니다. 옵션 추가금이 0원이 아닌 상품을 새로 조회하세요.</p>}
    {candidate && <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
      <p className="font-bold text-orange-950"><code>{candidate.goods_key}</code> · {Number(candidate.adjustment_bps ?? 0) / 100}%</p>
      <p className="mt-2 text-sm text-orange-900">기본 판매가 {won(candidate.current?.sell_price)} → {won(candidate.target?.sell_price)}</p>
      <p className="mt-1 text-sm text-orange-900">옵션 추가금 {amountText(candidate.current?.option_amounts)} → {amountText(candidate.target?.option_amounts)}</p>
    </div>}

    {canaryRequestId && <p className="mt-4 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs">option_canary_request_id: {canaryRequestId}</p>}
    {canaryResponse?.message && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900">{canaryResponse.message}</p>}
    {canaryResponse?.githubActionsUrl && <a href={canaryResponse.githubActionsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-blue-700 underline">옵션 카나리 GitHub Actions 열기</a>}
    {canaryResponse?.runUrl && <a href={canaryResponse.runUrl} target="_blank" rel="noreferrer" className="ml-4 mt-3 inline-block text-sm font-semibold text-blue-700 underline">옵션 카나리 완료 실행 열기</a>}
    {canaryResponse?.summary && <OptionCanaryResult summary={canaryResponse.summary} />}
  </section>;
}

function OptionCanaryResult({ summary }: { summary: OptionCanarySummary }) {
  const success = summary.status === "success";
  return <div className={`mt-5 rounded-xl border p-5 ${success ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
    <h3 className="font-bold">옵션 추가금 실제 변경 결과</h3>
    <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <Cell label="상태" value={summary.status ?? "-"} />
      <Cell label="goods_key" value={summary.goods_key ?? "-"} />
      <Cell label="판매가" value={`${won(summary.current?.sell_price)} → ${won(summary.target?.sell_price)}`} />
      <Cell label="상품·옵션 API" value={summary.product_api?.status ?? "-"} />
      <Cell label="쇼핑몰 성공" value={String(summary.mall_api_success_count ?? 0)} />
      <Cell label="쇼핑몰 실패" value={String(summary.mall_api_failure_count ?? 0)} />
      <Cell label="기본가격 재조회" value={summary.product_readback_ok ? "일치" : "불일치"} />
      <Cell label="옵션 목표값 재조회" value={summary.option_target_verified ? "일치" : "불일치"} />
      <Cell label="옵션 구조 보존" value={summary.option_structure_preserved ? "보존" : "불일치"} />
    </dl>
    <p className="mt-4 text-sm font-semibold">옵션 추가금: {amountText(summary.current?.option_amounts)} → {amountText(summary.target?.option_amounts)} · 재조회 {amountText(summary.verified?.option_amounts)}</p>
    {summary.error && <p className="mt-4 rounded-lg bg-white p-3 text-sm font-semibold text-red-900">{summary.error}</p>}
    {success && <p className="mt-4 font-bold text-emerald-900">옵션 추가금·기본가격·24개 쇼핑몰 가격 카나리를 통과했습니다. 같은 입력을 재실행하지 마세요.</p>}
  </div>;
}

function Cell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white/80 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-bold text-slate-950">{value}</dd></div>;
}
