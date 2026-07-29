"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  calculateShoplingAdjustedPriceColumns,
  parseShoplingPriceAdjustmentFile,
  parseShoplingPriceAdjustmentPaste,
  parseShoplingPriceAdjustmentRateBps,
  plannedShoplingPriceAdjustmentChunkCount,
  SHOPLING_PRICE_ADJUSTMENT_MAX_ROWS,
  type ShoplingPriceAdjustmentInputResult,
  type ShoplingPriceAdjustmentRow,
} from "@/lib/shoplingPriceAdjustmentInput";
import {
  parseShoplingPriceBulkFile,
  parseShoplingPriceBulkPaste,
  type ShoplingPriceBulkInputResult,
} from "@/lib/shoplingPriceModifyBulkInput";

type InputMode = "uniform" | "individual";

type Selection = {
  label: string;
  mode: InputMode;
  result: ShoplingPriceAdjustmentInputResult;
};

type PricePlanRow = {
  goods_key?: string;
  adjustment_bps?: number;
  current?: {
    sell_price?: number;
    consumer_price?: number;
    purchase_price?: number;
    option_amounts?: number[];
    option_signature?: string;
  };
  target?: {
    sell_price?: number;
    consumer_price?: number;
    purchase_price?: number;
    option_amounts?: number[];
    option_signature?: string;
  };
  option_combination_count?: number;
  mall_row_count?: number;
};

type PlanSummary = {
  status?: string;
  goods_key_count?: number;
  planned_goods_key_count?: number;
  failed_goods_key_count?: number;
  planned_mall_row_count?: number;
  rows?: PricePlanRow[];
  errors?: Array<{ goods_key?: string; error?: string }>;
};

type PlanResponse = {
  status?: string;
  message?: string;
  requestId?: string;
  githubActionsUrl?: string;
  runUrl?: string;
  runConclusion?: string | null;
  summary?: PlanSummary;
};

type CanarySummary = {
  status?: string;
  goods_key?: string;
  adjustment_bps?: number;
  current?: { sell_price?: number; option_amounts?: number[] };
  target?: { sell_price?: number; consumer_price?: number; purchase_price?: number; option_amounts?: number[] };
  product_api?: { code?: string; msg?: string; status?: string };
  mall_api_success_count?: number;
  mall_api_failure_count?: number;
  mall_api_result_count?: number;
  product_readback_ok?: boolean;
  option_amount_write_attempted?: boolean;
  option_signature_preserved?: boolean;
  verified?: { sell_price?: number; consumer_price?: number; purchase_price?: number };
  error?: string;
};

type CanaryResponse = {
  status?: string;
  message?: string;
  requestId?: string;
  githubActionsUrl?: string;
  runUrl?: string;
  runConclusion?: string | null;
  summary?: CanarySummary;
};

const PLAN_REQUEST_STORAGE_KEY = "shoplingPriceAdjustment.currentPlanRequestId";
const CANARY_REQUEST_STORAGE_KEY = "shoplingPriceAdjustment.currentCanaryRequestId";

const directionLabel = (row: ShoplingPriceAdjustmentRow) =>
  row.direction === "increase" ? "인상" : row.direction === "decrease" ? "인하" : "변경 없음";

const won = (value: number | undefined) =>
  Number.isFinite(value) ? `${Number(value).toLocaleString("ko-KR")}원` : "-";

function sameNumberArray(left: number[] | undefined, right: number[] | undefined) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function buildUniformAdjustmentResult(
  goodsInput: ShoplingPriceBulkInputResult,
  rateText: string,
): ShoplingPriceAdjustmentInputResult {
  if (goodsInput.goodsKeys.length > SHOPLING_PRICE_ADJUSTMENT_MAX_ROWS) {
    throw new Error(`유효한 상품은 최대 ${SHOPLING_PRICE_ADJUSTMENT_MAX_ROWS.toLocaleString("ko-KR")}개까지 입력할 수 있습니다.`);
  }
  const adjustmentBps = parseShoplingPriceAdjustmentRateBps(rateText);
  const template = parseShoplingPriceAdjustmentPaste(`1 ${rateText}`).rows[0];
  if (!template) throw new Error("공통 인상·인하율을 입력하세요.");
  const rows = goodsInput.goodsKeys.map((goodsKey) => ({ ...template, goodsKey, adjustmentBps }));
  return {
    source: goodsInput.source,
    originalCount: goodsInput.originalCount,
    rows,
    goodsKeys: goodsInput.goodsKeys,
    validCount: rows.length,
    duplicateCount: goodsInput.duplicateCount,
    conflictCount: 0,
    invalid: goodsInput.invalid,
    invalidCount: goodsInput.invalidCount,
  };
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
  if (!sameNumberArray(row.current?.option_amounts, row.target?.option_amounts)) {
    throw new Error("옵션 추가금 변경이 필요한 상품입니다. 옵션 전용 카나리 전에는 실제 변경할 수 없습니다.");
  }
  return {
    goods_key: goodsKey,
    adjustment_bps: adjustmentBps,
    expected_current_sell_price: expectedSell,
    expected_option_signature: optionSignature,
  };
}

export function ShoplingPriceAdjustmentInputPreview() {
  const [inputMode, setInputMode] = useState<InputMode>("uniform");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [uniformGoodsInput, setUniformGoodsInput] = useState<ShoplingPriceBulkInputResult | null>(null);
  const [uniformRate, setUniformRate] = useState("10");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [sampleSellPrice, setSampleSellPrice] = useState("10003");
  const [sampleRate, setSampleRate] = useState("10");

  const [planRunning, setPlanRunning] = useState(false);
  const [planFetching, setPlanFetching] = useState(false);
  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [planRequestId, setPlanRequestId] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem(PLAN_REQUEST_STORAGE_KEY) ?? "",
  );

  const [canaryRunning, setCanaryRunning] = useState(false);
  const [canaryFetching, setCanaryFetching] = useState(false);
  const [canaryResponse, setCanaryResponse] = useState<CanaryResponse | null>(null);
  const [canaryRequestId, setCanaryRequestId] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem(CANARY_REQUEST_STORAGE_KEY) ?? "",
  );

  const clearError = () => setError("");

  const clearCanary = () => {
    setCanaryResponse(null);
    setCanaryRequestId("");
    if (typeof window !== "undefined") localStorage.removeItem(CANARY_REQUEST_STORAGE_KEY);
  };

  const clearPlan = () => {
    setPlanResponse(null);
    setPlanRequestId("");
    if (typeof window !== "undefined") localStorage.removeItem(PLAN_REQUEST_STORAGE_KEY);
    clearCanary();
  };

  const applySelection = (next: Selection) => {
    setSelection(next);
    clearPlan();
  };

  const changeMode = (mode: InputMode) => {
    setInputMode(mode);
    setSelection(null);
    setUniformGoodsInput(null);
    clearError();
    clearPlan();
  };

  const applyUniformGoods = (
    goodsInput: ShoplingPriceBulkInputResult,
    label: string,
    rateText = uniformRate,
  ) => {
    setUniformGoodsInput(goodsInput);
    applySelection({ label, mode: "uniform", result: buildUniformAdjustmentResult(goodsInput, rateText) });
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReading(true);
    clearError();
    try {
      if (inputMode === "uniform") {
        applyUniformGoods(await parseShoplingPriceBulkFile(file), `${file.name} · 일괄 동일률`);
      } else {
        applySelection({
          label: `${file.name} · 상품별 개별률`,
          mode: "individual",
          result: await parseShoplingPriceAdjustmentFile(file),
        });
      }
    } catch (caught) {
      setSelection(null);
      setError(caught instanceof Error ? caught.message : "파일을 읽을 수 없습니다.");
    } finally {
      setReading(false);
    }
  };

  const onUniformPaste = (value: string) => {
    clearError();
    try {
      applyUniformGoods(parseShoplingPriceBulkPaste(value), "직접 붙여넣기 · 일괄 동일률");
    } catch (caught) {
      setSelection(null);
      setError(caught instanceof Error ? caught.message : "상품번호를 검사할 수 없습니다.");
    }
  };

  const onUniformRate = (value: string) => {
    setUniformRate(value);
    clearError();
    if (!uniformGoodsInput) return;
    try {
      applySelection({
        label: "직접 입력 · 일괄 동일률",
        mode: "uniform",
        result: buildUniformAdjustmentResult(uniformGoodsInput, value),
      });
    } catch (caught) {
      setSelection(null);
      setError(caught instanceof Error ? caught.message : "공통 조정률을 검사할 수 없습니다.");
    }
  };

  const onIndividualPaste = (value: string) => {
    clearError();
    try {
      applySelection({
        label: "직접 붙여넣기 · 상품별 개별률",
        mode: "individual",
        result: parseShoplingPriceAdjustmentPaste(value),
      });
    } catch (caught) {
      setSelection(null);
      setError(caught instanceof Error ? caught.message : "입력값을 검사할 수 없습니다.");
    }
  };

  const sample = useMemo(() => {
    try {
      const current = Number(sampleSellPrice.replaceAll(",", ""));
      return {
        result: calculateShoplingAdjustedPriceColumns(current, parseShoplingPriceAdjustmentRateBps(sampleRate)),
        error: "",
      };
    } catch (caught) {
      return { result: null, error: caught instanceof Error ? caught.message : "계산할 수 없습니다." };
    }
  }, [sampleRate, sampleSellPrice]);

  const runReadonlyPlan = async () => {
    if (!selection || planRunning || selection.result.validCount === 0) return;
    const canaryRows = selection.result.rows.slice(0, 10).map((row) => ({
      goods_key: row.goodsKey,
      adjustment_bps: row.adjustmentBps,
    }));
    if (!window.confirm(
      `첫 ${canaryRows.length}개 상품의 현재 판매가와 옵션 추가금을 샵플링 공식 조회 API로 읽습니다.\n` +
      "가격 수정 API는 호출하지 않습니다. 계속하시겠습니까?",
    )) return;
    setPlanRunning(true);
    setPlanResponse(null);
    clearCanary();
    clearError();
    try {
      const response = await fetch("/api/shopling-price-adjustment/plan/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: canaryRows }),
      });
      const body = await response.json() as PlanResponse;
      if (!response.ok || body.status === "error") throw new Error(body.message ?? `읽기 전용 계획 요청 실패 status=${response.status}`);
      const requestId = body.requestId ?? "";
      if (!requestId) throw new Error("계획 요청 추적 ID가 없습니다.");
      setPlanRequestId(requestId);
      localStorage.setItem(PLAN_REQUEST_STORAGE_KEY, requestId);
      setPlanResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "읽기 전용 계획 요청 중 오류가 발생했습니다.");
    } finally {
      setPlanRunning(false);
    }
  };

  const fetchReadonlyPlan = async () => {
    if (!planRequestId || planFetching) return;
    setPlanFetching(true);
    clearError();
    try {
      const response = await fetch(
        `/api/shopling-price-adjustment/plan/result?request_id=${encodeURIComponent(planRequestId)}`,
        { cache: "no-store" },
      );
      const body = await response.json() as PlanResponse;
      if (!response.ok || body.status === "error") throw new Error(body.message ?? `계획 결과 조회 실패 status=${response.status}`);
      setPlanResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "읽기 전용 계획 결과 조회 중 오류가 발생했습니다.");
    } finally {
      setPlanFetching(false);
    }
  };

  const firstPlannedRow = Array.isArray(planResponse?.summary?.rows)
    ? planResponse?.summary?.rows?.[0] ?? null
    : null;

  const canaryReady = Boolean(
    planResponse?.summary?.status === "success"
    && firstPlannedRow
    && sameNumberArray(firstPlannedRow.current?.option_amounts, firstPlannedRow.target?.option_amounts),
  );

  const runWriteCanary = async () => {
    if (!firstPlannedRow || canaryRunning) return;
    clearError();
    let input;
    try { input = buildCanaryInput(firstPlannedRow); }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : "실제 변경 카나리 계획이 올바르지 않습니다.");
      return;
    }
    const targetSell = firstPlannedRow.target?.sell_price;
    if (!window.confirm(
      `실제 샵플링 가격을 변경합니다.\n\n` +
      `goods_key: ${input.goods_key}\n` +
      `기본 판매가: ${won(input.expected_current_sell_price)} → ${won(targetSell)}\n` +
      `24개 쇼핑몰 가격정책도 함께 적용합니다.\n` +
      `옵션 추가금은 변경하지 않습니다.\n\n` +
      `실행 직전 현재가와 옵션 서명이 달라졌으면 자동 차단됩니다. 계속하시겠습니까?`,
    )) return;
    setCanaryRunning(true);
    setCanaryResponse(null);
    try {
      const response = await fetch("/api/shopling-price-adjustment/canary/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const body = await response.json() as CanaryResponse;
      if (!response.ok || body.status === "error") throw new Error(body.message ?? `실제 변경 카나리 요청 실패 status=${response.status}`);
      const requestId = body.requestId ?? "";
      if (!requestId) throw new Error("실제 변경 카나리 요청 추적 ID가 없습니다.");
      setCanaryRequestId(requestId);
      localStorage.setItem(CANARY_REQUEST_STORAGE_KEY, requestId);
      setCanaryResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "실제 변경 카나리 요청 중 오류가 발생했습니다.");
    } finally {
      setCanaryRunning(false);
    }
  };

  const fetchWriteCanary = async () => {
    if (!canaryRequestId || canaryFetching) return;
    setCanaryFetching(true);
    clearError();
    try {
      const response = await fetch(
        `/api/shopling-price-adjustment/canary/result?request_id=${encodeURIComponent(canaryRequestId)}`,
        { cache: "no-store" },
      );
      const body = await response.json() as CanaryResponse;
      if (!response.ok || body.status === "error") throw new Error(body.message ?? `실제 변경 카나리 결과 조회 실패 status=${response.status}`);
      setCanaryResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "실제 변경 카나리 결과 조회 중 오류가 발생했습니다.");
    } finally {
      setCanaryFetching(false);
    }
  };

  return <div className="space-y-8">
    <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-950">대량 goods_key · 인상/인하율 입력</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">일괄 동일률 또는 상품별 개별률 중 하나를 선택합니다. 최대 10,000개까지 준비하고 첫 10개를 조회 카나리로 확인합니다.</p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">1만 개 Bulk 준비</span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => changeMode("uniform")} className={`rounded-xl border-2 p-4 text-left ${inputMode === "uniform" ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}>
          <span className="block font-bold">일괄 설정</span>
          <span className="mt-1 block text-sm text-slate-600">goods_key 목록과 공통 인상·인하율을 따로 입력합니다.</span>
        </button>
        <button type="button" onClick={() => changeMode("individual")} className={`rounded-xl border-2 p-4 text-left ${inputMode === "individual" ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}>
          <span className="block font-bold">개별 설정</span>
          <span className="mt-1 block text-sm text-slate-600">상품마다 서로 다른 인상·인하율을 한 행씩 입력합니다.</span>
        </button>
      </div>

      {inputMode === "uniform" ? <div className="mt-6 space-y-5">
        <label className="block rounded-xl border border-blue-200 bg-blue-50/50 p-4 text-sm font-bold text-slate-800">
          전체 상품 공통 인상·인하율
          <input value={uniformRate} onChange={(event) => onUniformRate(event.target.value)} placeholder="예: 30 또는 -10" className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3 text-base" />
          <span className="mt-2 block font-normal text-slate-600">30은 30% 인상, -10은 10% 인하입니다.</span>
        </label>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border p-4">
            <h3 className="font-bold">goods_key 1열 CSV·XLSX</h3>
            <input key="uniform-file" aria-label="일괄 상품번호 파일 업로드" type="file" accept=".csv,.xlsx" onChange={onFile} className="mt-3 block w-full" />
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm"><strong>고정 양식</strong><p>A1: <code>goods_key</code></p><p>A2부터 상품번호</p><p>B열 이후 데이터 금지</p></div>
          </div>
          <label className="rounded-xl border p-4 font-bold">
            goods_key 목록
            <textarea aria-label="일괄 상품번호 직접 붙여넣기" onChange={(event) => onUniformPaste(event.target.value)} placeholder={"116090\n119836\n119837"} className="mt-3 min-h-44 w-full rounded-lg border p-3 font-mono text-sm" />
            <span className="mt-2 block text-sm font-normal text-slate-600">쉼표·공백·탭·줄바꿈으로 상품번호만 입력합니다.</span>
          </label>
        </div>
      </div> : <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border p-4">
          <h3 className="font-bold">goods_key + 조정률 2열 CSV·XLSX</h3>
          <input key="individual-file" aria-label="개별 가격 조정 파일 업로드" type="file" accept=".csv,.xlsx" onChange={onFile} className="mt-3 block w-full" />
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm"><strong>고정 양식</strong><p>A열: <code>goods_key</code></p><p>B열: <code>adjustment_rate</code></p><p>예: <code>119836,10</code> · <code>119837,-5</code></p></div>
        </div>
        <label className="rounded-xl border p-4 font-bold">
          상품별 개별 입력
          <textarea aria-label="goods_key와 조정률 직접 붙여넣기" onChange={(event) => onIndividualPaste(event.target.value)} placeholder={"119836 10\n119837 -5\n119838 7.25%"} className="mt-3 min-h-44 w-full rounded-lg border p-3 font-mono text-sm" />
          <span className="mt-2 block text-sm font-normal text-slate-600">한 줄에 상품번호와 해당 상품의 조정률을 입력합니다.</span>
        </label>
      </div>}

      {reading && <p className="mt-4 rounded-lg bg-blue-50 p-3 font-semibold text-blue-800">파일을 검사하고 있습니다.</p>}
      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 font-semibold text-red-800">{error}</p>}
      {selection ? <AdjustmentPreview selection={selection} /> : <p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">입력 방식을 선택한 뒤 상품번호와 인상·인하율을 입력하면 미리보기가 표시됩니다.</p>}
    </section>

    <section className="rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-bold text-slate-950">공식 API 현재가·옵션 읽기 전용 카나리</h2><p className="mt-2 text-sm leading-6 text-slate-600">선택된 계획의 첫 10개만 조회하여 현재 판매가, 옵션 추가금, 변경 예정가와 24개 쇼핑몰 가격 계획을 만듭니다.</p></div>
        <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-bold text-indigo-900">조회 전용</span>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" disabled={!selection?.result.validCount || planRunning} onClick={() => void runReadonlyPlan()} className="rounded-lg bg-indigo-700 px-4 py-3 font-bold text-white disabled:opacity-50">{planRunning ? "조회 요청 중..." : `첫 ${Math.min(selection?.result.validCount ?? 0, 10)}개 현재가·옵션 조회`}</button>
        <button type="button" disabled={!planRequestId || planFetching} onClick={() => void fetchReadonlyPlan()} className="rounded-lg bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">{planFetching ? "결과 확인 중..." : "조회 결과 가져오기"}</button>
      </div>
      {planRequestId && <p className="mt-4 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs">request_id: {planRequestId}</p>}
      {planResponse?.message && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900">{planResponse.message}</p>}
      {planResponse?.githubActionsUrl && <a href={planResponse.githubActionsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-blue-700 underline">GitHub Actions 열기</a>}
      {planResponse?.runUrl && <a href={planResponse.runUrl} target="_blank" rel="noreferrer" className="ml-4 mt-3 inline-block text-sm font-semibold text-blue-700 underline">완료 실행 열기</a>}
      {planResponse?.summary && <ReadonlyPlanResult summary={planResponse.summary} />}
    </section>

    <section className="rounded-2xl border-2 border-red-300 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-950">단일 상품 실제 가격 변경 카나리</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">읽기 전용 계획의 첫 상품 1개만 기본 가격과 24개 쇼핑몰 가격정책에 실제 반영합니다. 옵션 추가금 변경이 필요한 상품은 자동 차단합니다.</p>
        </div>
        <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-900">실제 가격 변경</span>
      </div>
      {!firstPlannedRow && <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">먼저 읽기 전용 결과를 가져오세요.</p>}
      {firstPlannedRow && !canaryReady && <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm font-semibold text-amber-900">첫 상품은 옵션 추가금 변경이 필요하거나 읽기 전용 계획이 완전 성공 상태가 아닙니다. 옵션 전용 카나리 전에는 실제 변경할 수 없습니다.</p>}
      {firstPlannedRow && canaryReady && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="font-bold text-red-950"><code>{firstPlannedRow.goods_key}</code> · {Number(firstPlannedRow.adjustment_bps ?? 0) / 100}%</p>
        <p className="mt-2 text-sm text-red-900">기본 판매가 {won(firstPlannedRow.current?.sell_price)} → {won(firstPlannedRow.target?.sell_price)} · 쇼핑몰 가격 24행 · 옵션 추가금 변경 없음</p>
      </div>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" disabled={!canaryReady || canaryRunning} onClick={() => void runWriteCanary()} className="rounded-lg bg-red-700 px-4 py-3 font-bold text-white disabled:opacity-50">{canaryRunning ? "실제 변경 요청 중..." : "이 1개 실제 가격 변경 테스트"}</button>
        <button type="button" disabled={!canaryRequestId || canaryFetching} onClick={() => void fetchWriteCanary()} className="rounded-lg bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">{canaryFetching ? "결과 확인 중..." : "실제 변경 결과 가져오기"}</button>
      </div>
      {canaryRequestId && <p className="mt-4 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs">canary_request_id: {canaryRequestId}</p>}
      {canaryResponse?.message && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-900">{canaryResponse.message}</p>}
      {canaryResponse?.githubActionsUrl && <a href={canaryResponse.githubActionsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-blue-700 underline">카나리 GitHub Actions 열기</a>}
      {canaryResponse?.runUrl && <a href={canaryResponse.runUrl} target="_blank" rel="noreferrer" className="ml-4 mt-3 inline-block text-sm font-semibold text-blue-700 underline">카나리 완료 실행 열기</a>}
      {canaryResponse?.summary && <WriteCanaryResult summary={canaryResponse.summary} />}
    </section>

    <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-950">10원 단위 올림 계산 검산</h2>
      <p className="mt-2 text-sm text-slate-600">현재 판매가를 조정한 뒤 10원 단위로 올리고, 소비자가 1.5배·원가 0.5배를 계산합니다.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">현재 판매가<input value={sampleSellPrice} onChange={(event) => setSampleSellPrice(event.target.value)} inputMode="numeric" className="mt-2 w-full rounded-lg border p-3" /></label>
        <label className="text-sm font-semibold text-slate-700">인상·인하율<input value={sampleRate} onChange={(event) => setSampleRate(event.target.value)} placeholder="10 또는 -5" className="mt-2 w-full rounded-lg border p-3" /></label>
      </div>
      {sample.result ? <dl className="mt-5 grid gap-3 sm:grid-cols-3"><ResultCell label="변경 판매가" value={`${sample.result.sellPrice.toLocaleString("ko-KR")}원`} /><ResultCell label="소비자가 (×1.5)" value={`${sample.result.consumerPrice.toLocaleString("ko-KR")}원`} /><ResultCell label="원가 (×0.5)" value={`${sample.result.purchasePrice.toLocaleString("ko-KR")}원`} /></dl> : <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">{sample.error}</p>}
    </section>

    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
      <h2 className="font-bold text-slate-950">운영 안전 경계</h2>
      <p className="mt-2">실제 Bulk 작업은 최대 10,000개이며, 첫 10개를 먼저 실행한 뒤 나머지를 최대 50개씩 직렬 처리합니다.</p>
      <p className="mt-2">각 상품 실행 직전 현재 판매가·옵션 서명을 재검증하며, 첫 실패 또는 전송 불확실 시 전체 진행을 중단합니다. 자동 재시도는 사용하지 않습니다.</p>
    </section>
  </div>;
}

function AdjustmentPreview({ selection }: { selection: Selection }) {
  const { result } = selection;
  const chunkCount = plannedShoplingPriceAdjustmentChunkCount(result.validCount);
  const previewRows = result.rows.slice(0, 20);
  const lastRows = result.rows.length > 25 ? result.rows.slice(-5) : [];
  return <div className="mt-6 rounded-xl border border-emerald-200 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-bold text-emerald-950">입력 검증 완료</h3><p className="mt-1 text-sm text-slate-600">{selection.label}</p></div>
      <div className="flex gap-2"><span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-900">{selection.mode === "uniform" ? "일괄 설정" : "개별 설정"}</span><span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900">유효 {result.validCount.toLocaleString("ko-KR")}개</span></div>
    </div>
    <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4"><ResultCell label="원본 행" value={result.originalCount.toLocaleString("ko-KR")} /><ResultCell label="유효 상품" value={result.validCount.toLocaleString("ko-KR")} /><ResultCell label="동일 중복 제외" value={result.duplicateCount.toLocaleString("ko-KR")} /><ResultCell label="충돌 상품 제외" value={result.conflictCount.toLocaleString("ko-KR")} /><ResultCell label="잘못된 행" value={result.invalidCount.toLocaleString("ko-KR")} /><ResultCell label="예상 청크" value={`${chunkCount.toLocaleString("ko-KR")}개`} /><ResultCell label="첫 시험" value={`최대 ${Math.min(10, result.validCount).toLocaleString("ko-KR")}개`} /><ResultCell label="일반 청크" value="최대 50개씩" /></dl>
    {result.invalidCount > 0 && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-bold">제외 사유</p><ul className="mt-2 list-disc pl-5">{result.invalid.slice(0, 20).map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul></div>}
    <AdjustmentTable title="첫 20개" rows={previewRows} />
    {lastRows.length > 0 && <AdjustmentTable title="마지막 5개" rows={lastRows} />}
  </div>;
}

function ReadonlyPlanResult({ summary }: { summary: PlanSummary }) {
  const rows = Array.isArray(summary.rows) ? summary.rows : [];
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  return <div className="mt-5 rounded-xl border border-indigo-200 p-5">
    <h3 className="font-bold text-indigo-950">읽기 전용 계획 결과</h3>
    <dl className="mt-4 grid gap-3 sm:grid-cols-4"><ResultCell label="상태" value={summary.status ?? "-"} /><ResultCell label="요청 상품" value={String(summary.goods_key_count ?? 0)} /><ResultCell label="계획 성공" value={String(summary.planned_goods_key_count ?? 0)} /><ResultCell label="계획 실패" value={String(summary.failed_goods_key_count ?? 0)} /><ResultCell label="예정 쇼핑몰 행" value={String(summary.planned_mall_row_count ?? 0)} /></dl>
    <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b bg-slate-50"><th className="p-2">goods_key</th><th className="p-2">조정률</th><th className="p-2">현재 판매가</th><th className="p-2">변경 판매가</th><th className="p-2">현재 옵션 추가금</th><th className="p-2">변경 옵션 추가금</th><th className="p-2">쇼핑몰 행</th></tr></thead><tbody>{rows.map((row, index) => <tr className="border-b" key={row.goods_key ?? index}><td className="p-2 font-mono">{row.goods_key ?? "-"}</td><td className="p-2">{Number(row.adjustment_bps ?? 0) / 100}%</td><td className="p-2">{won(row.current?.sell_price)}</td><td className="p-2 font-bold">{won(row.target?.sell_price)}</td><td className="p-2">{row.current?.option_amounts?.join(", ") || "없음"}</td><td className="p-2 font-bold">{row.target?.option_amounts?.join(", ") || "없음"}</td><td className="p-2">{row.mall_row_count ?? 0}</td></tr>)}</tbody></table></div>
    {errors.length > 0 && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900"><p className="font-bold">계획 실패</p><ul className="mt-2 list-disc pl-5">{errors.map((item, index) => <li key={`${item.goods_key}-${index}`}><code>{item.goods_key || "-"}</code>: {item.error || "원인 없음"}</li>)}</ul></div>}
  </div>;
}

function WriteCanaryResult({ summary }: { summary: CanarySummary }) {
  const success = summary.status === "success";
  return <div className={`mt-5 rounded-xl border p-5 ${success ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
    <h3 className="font-bold">실제 가격 변경 카나리 결과</h3>
    <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <ResultCell label="상태" value={summary.status ?? "-"} />
      <ResultCell label="goods_key" value={summary.goods_key ?? "-"} />
      <ResultCell label="현재 → 목표 판매가" value={`${won(summary.current?.sell_price)} → ${won(summary.target?.sell_price)}`} />
      <ResultCell label="상품 기본가격 API" value={summary.product_api?.status ?? "-"} />
      <ResultCell label="쇼핑몰 성공" value={String(summary.mall_api_success_count ?? 0)} />
      <ResultCell label="쇼핑몰 실패" value={String(summary.mall_api_failure_count ?? 0)} />
      <ResultCell label="기본가격 재조회" value={summary.product_readback_ok ? "일치" : "불일치"} />
      <ResultCell label="옵션 서명 보존" value={summary.option_signature_preserved ? "보존" : "불일치"} />
    </dl>
    {summary.verified && <p className="mt-4 text-sm font-semibold">재조회: 판매가 {won(summary.verified.sell_price)} · 소비자가 {won(summary.verified.consumer_price)} · 원가 {won(summary.verified.purchase_price)}</p>}
    {summary.error && <p className="mt-4 rounded-lg bg-white p-3 text-sm font-semibold text-red-900">{summary.error}</p>}
    {success && <p className="mt-4 font-bold text-emerald-900">단일 상품 기본가격·24개 쇼핑몰 가격 카나리를 통과했습니다. 같은 입력을 다시 실행하지 말고 다음 단계로 진행하세요.</p>}
  </div>;
}

function AdjustmentTable({ title, rows }: { title: string; rows: ShoplingPriceAdjustmentRow[] }) {
  return <div className="mt-5 overflow-x-auto"><h4 className="mb-2 font-bold text-slate-900">{title}</h4><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b bg-slate-50"><th className="p-2">goods_key</th><th className="p-2">방향</th><th className="p-2">조정률</th><th className="p-2">내부 정수값</th></tr></thead><tbody>{rows.map((row) => <tr className="border-b" key={row.goodsKey}><td className="p-2 font-mono">{row.goodsKey}</td><td className="p-2">{directionLabel(row)}</td><td className="p-2 font-bold">{row.adjustmentRate}</td><td className="p-2 text-slate-500">{row.adjustmentBps} bps</td></tr>)}</tbody></table></div>;
}

function ResultCell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white/80 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-bold text-slate-950">{value}</dd></div>;
}
