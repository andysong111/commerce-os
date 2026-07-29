"use client";

import { useMemo, useState } from "react";
import { requestShoplingPriceAdjustmentApi } from "@/lib/shoplingPriceAdjustmentApiClient";

type PricePlanRow = {
  goods_key?: string;
  adjustment_bps?: number;
  current?: { sell_price?: number; option_amounts?: number[]; option_signature?: string };
  target?: { sell_price?: number; consumer_price?: number; purchase_price?: number; option_amounts?: number[]; option_signature?: string };
};

type PlanResponse = {
  status?: string;
  message?: string;
  requestId?: string;
  summary?: { status?: string; rows?: PricePlanRow[] };
};

type UnifiedSummary = {
  status?: string;
  goods_key?: string;
  current?: { sell_price?: number; option_amounts?: number[] };
  target?: { sell_price?: number; consumer_price?: number; purchase_price?: number; option_amounts?: number[] };
  product_api?: { status?: string; code?: string; msg?: string };
  mall_api_success_count?: number;
  mall_api_failure_count?: number;
  product_readback_ok?: boolean;
  option_signature_preserved?: boolean;
  option_structure_preserved?: boolean;
  option_target_verified?: boolean;
  verified?: { sell_price?: number; consumer_price?: number; purchase_price?: number; option_amounts?: number[] };
  error?: string;
};

type UnifiedResponse = {
  status?: string;
  message?: string;
  requestId?: string;
  githubActionsUrl?: string;
  runUrl?: string;
  summary?: UnifiedSummary;
};

type ExecutionMode = "base" | "option";

const PLAN_REQUEST_STORAGE_KEY = "shoplingPriceAdjustment.currentPlanRequestId";
const UNIFIED_REQUEST_STORAGE_KEY = "shoplingPriceAdjustment.currentUnifiedCanaryRequestId";
const UNIFIED_MODE_STORAGE_KEY = "shoplingPriceAdjustment.currentUnifiedCanaryMode";

const won = (value: number | undefined) => Number.isFinite(value) ? `${Number(value).toLocaleString("ko-KR")}원` : "-";
const amountText = (values: number[] | undefined) => Array.isArray(values) && values.length > 0
  ? values.map((value) => `${value.toLocaleString("ko-KR")}원`).join(", ")
  : "없음";

function sameNumberArray(left: number[] | undefined, right: number[] | undefined) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function buildCanaryInput(row: PricePlanRow) {
  const goodsKey = row.goods_key;
  const adjustmentBps = row.adjustment_bps;
  const expectedSell = row.current?.sell_price;
  const optionSignature = row.current?.option_signature;
  if (typeof goodsKey !== "string" || !/^\d+$/.test(goodsKey)) throw new Error("카나리 goods_key가 없습니다.");
  if (typeof adjustmentBps !== "number" || !Number.isInteger(adjustmentBps)) throw new Error("카나리 조정률이 없습니다.");
  if (typeof expectedSell !== "number" || !Number.isSafeInteger(expectedSell) || expectedSell <= 0) throw new Error("읽기 전용 현재 판매가가 없습니다.");
  if (typeof optionSignature !== "string" || !/^[0-9a-f]{64}$/i.test(optionSignature)) throw new Error("읽기 전용 옵션 서명이 없습니다.");
  return {
    goods_key: goodsKey,
    adjustment_bps: adjustmentBps,
    expected_current_sell_price: expectedSell,
    expected_option_signature: optionSignature,
  };
}

export function ShoplingPriceAdjustmentUnifiedCanaryPanel() {
  const [planLoading, setPlanLoading] = useState(false);
  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [requestId, setRequestId] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem(UNIFIED_REQUEST_STORAGE_KEY) ?? "");
  const [executionMode, setExecutionMode] = useState<ExecutionMode | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(UNIFIED_MODE_STORAGE_KEY);
    return stored === "base" || stored === "option" ? stored : null;
  });
  const [response, setResponse] = useState<UnifiedResponse | null>(null);
  const [error, setError] = useState("");

  const candidate = useMemo(() => {
    if (planResponse?.summary?.status !== "success") return null;
    const rows = Array.isArray(planResponse.summary.rows) ? planResponse.summary.rows : [];
    return rows[0] ?? null;
  }, [planResponse]);

  const requiresOptionWrite = Boolean(candidate && !sameNumberArray(candidate.current?.option_amounts, candidate.target?.option_amounts));
  const mode: ExecutionMode = requiresOptionWrite ? "option" : "base";

  const loadLatestPlan = async () => {
    const planRequestId = typeof window === "undefined" ? "" : localStorage.getItem(PLAN_REQUEST_STORAGE_KEY) ?? "";
    if (!planRequestId) {
      setError("먼저 위의 읽기 전용 카나리에서 상품을 조회하고 결과를 가져오세요.");
      return;
    }
    setPlanLoading(true);
    setError("");
    try {
      const result = await requestShoplingPriceAdjustmentApi(`/api/shopling-price-adjustment/plan/result?request_id=${encodeURIComponent(planRequestId)}`, { cache: "no-store" });
      const body = await result.json() as PlanResponse;
      if (!result.ok || body.status === "error") throw new Error(body.message ?? `읽기 전용 결과 조회 실패 status=${result.status}`);
      setPlanResponse(body);
      setResponse(null);
      setRequestId("");
      setExecutionMode(null);
      localStorage.removeItem(UNIFIED_REQUEST_STORAGE_KEY);
      localStorage.removeItem(UNIFIED_MODE_STORAGE_KEY);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "읽기 전용 결과를 가져오지 못했습니다.");
    } finally {
      setPlanLoading(false);
    }
  };

  const runCanary = async () => {
    if (!candidate || running) return;
    setError("");
    let input;
    try { input = buildCanaryInput(candidate); }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : "실제 변경 카나리 입력이 올바르지 않습니다.");
      return;
    }

    const optionMessage = requiresOptionWrite
      ? `옵션 추가금: ${amountText(candidate.current?.option_amounts)} → ${amountText(candidate.target?.option_amounts)}\n`
      : "옵션 추가금: 변경 없음\n";

    if (!window.confirm(
      `실제 샵플링 가격을 변경합니다.\n\n` +
      `goods_key: ${input.goods_key}\n` +
      `기본 판매가: ${won(input.expected_current_sell_price)} → ${won(candidate.target?.sell_price)}\n` +
      optionMessage +
      `24개 쇼핑몰 가격정책도 함께 적용합니다.\n\n` +
      `옵션 추가금이 있으면 판매가와 같은 조정률로 자동 변경합니다. 계속하시겠습니까?`,
    )) return;

    setRunning(true);
    setResponse(null);
    try {
      const endpoint = requiresOptionWrite
        ? "/api/shopling-price-adjustment/option-canary/run"
        : "/api/shopling-price-adjustment/canary/run";
      const result = await requestShoplingPriceAdjustmentApi(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const body = await result.json() as UnifiedResponse;
      if (!result.ok || body.status === "error") throw new Error(body.message ?? `실제 변경 카나리 요청 실패 status=${result.status}`);
      const nextRequestId = body.requestId ?? "";
      if (!nextRequestId) throw new Error("실제 변경 카나리 요청 추적 ID가 없습니다.");
      setRequestId(nextRequestId);
      setExecutionMode(mode);
      localStorage.setItem(UNIFIED_REQUEST_STORAGE_KEY, nextRequestId);
      localStorage.setItem(UNIFIED_MODE_STORAGE_KEY, mode);
      setResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "실제 변경 카나리 요청 중 오류가 발생했습니다.");
    } finally {
      setRunning(false);
    }
  };

  const fetchResult = async () => {
    if (!requestId || !executionMode || fetching) return;
    setFetching(true);
    setError("");
    try {
      const endpoint = executionMode === "option"
        ? "/api/shopling-price-adjustment/option-canary/result"
        : "/api/shopling-price-adjustment/canary/result";
      const result = await requestShoplingPriceAdjustmentApi(`${endpoint}?request_id=${encodeURIComponent(requestId)}`, { cache: "no-store" });
      const body = await result.json() as UnifiedResponse;
      if (!result.ok || body.status === "error") throw new Error(body.message ?? `실제 변경 결과 조회 실패 status=${result.status}`);
      setResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "실제 변경 결과 조회 중 오류가 발생했습니다.");
    } finally {
      setFetching(false);
    }
  };

  return <section className="mt-8 rounded-2xl border-2 border-red-300 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-slate-950">단일 상품 가격 변경 카나리</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">판매가를 변경할 때 옵션 추가금이 있으면 같은 조정률로 함께 변경합니다. 상품 상태를 보고 기본가격 전용 또는 기본가격+옵션 경로를 자동 선택합니다.</p>
      </div>
      <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-900">자동 경로 선택</span>
    </div>

    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" disabled={planLoading} onClick={() => void loadLatestPlan()} className="rounded-lg bg-red-700 px-4 py-3 font-bold text-white disabled:opacity-50">{planLoading ? "계획 확인 중..." : "최근 읽기 전용 계획 불러오기"}</button>
      <button type="button" disabled={!candidate || running} onClick={() => void runCanary()} className="rounded-lg bg-red-700 px-4 py-3 font-bold text-white disabled:opacity-50">{running ? "실제 변경 요청 중..." : "이 1개 실제 가격 변경 테스트"}</button>
      <button type="button" disabled={!requestId || !executionMode || fetching} onClick={() => void fetchResult()} className="rounded-lg bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">{fetching ? "결과 확인 중..." : "실제 변경 결과 가져오기"}</button>
    </div>

    {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>}
    {planResponse && !candidate && <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm font-semibold text-amber-900">읽기 전용 계획의 첫 상품을 찾지 못했습니다. 위에서 조회를 다시 실행하세요.</p>}
    {candidate && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-bold text-red-950"><code>{candidate.goods_key}</code> · {Number(candidate.adjustment_bps ?? 0) / 100}%</p>
        <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-red-900">{requiresOptionWrite ? "기본가격 + 옵션 추가금" : "기본가격"}</span>
      </div>
      <p className="mt-2 text-sm text-red-900">기본 판매가 {won(candidate.current?.sell_price)} → {won(candidate.target?.sell_price)}</p>
      <p className="mt-1 text-sm text-red-900">옵션 추가금 {amountText(candidate.current?.option_amounts)} → {amountText(candidate.target?.option_amounts)}</p>
    </div>}

    {requestId && <p className="mt-4 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs">unified_canary_request_id: {requestId} · mode: {executionMode ?? "-"}</p>}
    {response?.message && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900">{response.message}</p>}
    {response?.githubActionsUrl && <a href={response.githubActionsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-blue-700 underline">카나리 GitHub Actions 열기</a>}
    {response?.runUrl && <a href={response.runUrl} target="_blank" rel="noreferrer" className="ml-4 mt-3 inline-block text-sm font-semibold text-blue-700 underline">카나리 완료 실행 열기</a>}
    {response?.summary && <UnifiedResult summary={response.summary} />}
  </section>;
}

function UnifiedResult({ summary }: { summary: UnifiedSummary }) {
  const success = summary.status === "success";
  const optionVerified = summary.option_target_verified ?? summary.option_signature_preserved ?? true;
  const structurePreserved = summary.option_structure_preserved ?? summary.option_signature_preserved ?? true;
  return <div className={`mt-5 rounded-xl border p-5 ${success ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
    <h3 className="font-bold">단일 상품 실제 가격 변경 결과</h3>
    <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <Cell label="상태" value={summary.status ?? "-"} />
      <Cell label="goods_key" value={summary.goods_key ?? "-"} />
      <Cell label="판매가" value={`${won(summary.current?.sell_price)} → ${won(summary.target?.sell_price)}`} />
      <Cell label="상품 API" value={summary.product_api?.status ?? "-"} />
      <Cell label="쇼핑몰 성공" value={String(summary.mall_api_success_count ?? 0)} />
      <Cell label="쇼핑몰 실패" value={String(summary.mall_api_failure_count ?? 0)} />
      <Cell label="기본가격 재조회" value={summary.product_readback_ok ? "일치" : "불일치"} />
      <Cell label="옵션 목표값" value={optionVerified ? "일치" : "불일치"} />
      <Cell label="옵션 구조" value={structurePreserved ? "보존" : "불일치"} />
    </dl>
    <p className="mt-4 text-sm font-semibold">옵션 추가금: {amountText(summary.current?.option_amounts)} → {amountText(summary.target?.option_amounts)}{summary.verified?.option_amounts ? ` · 재조회 ${amountText(summary.verified.option_amounts)}` : ""}</p>
    {summary.verified && <p className="mt-2 text-sm font-semibold">재조회: 판매가 {won(summary.verified.sell_price)} · 소비자가 {won(summary.verified.consumer_price)} · 원가 {won(summary.verified.purchase_price)}</p>}
    {summary.error && <p className="mt-4 rounded-lg bg-white p-3 text-sm font-semibold text-red-900">{summary.error}</p>}
    {success && <p className="mt-4 font-bold text-emerald-900">기본가격과 필요한 옵션 추가금, 24개 쇼핑몰 가격을 함께 반영했습니다. 같은 입력을 다시 실행하지 마세요.</p>}
  </div>;
}

function Cell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white/80 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-bold text-slate-950">{value}</dd></div>;
}
