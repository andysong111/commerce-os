"use client";

import { ChangeEvent, useMemo, useState } from "react";
import {
  calculateShoplingAdjustedPriceColumns,
  parseShoplingPriceAdjustmentFile,
  parseShoplingPriceAdjustmentPaste,
  parseShoplingPriceAdjustmentRateBps,
  plannedShoplingPriceAdjustmentChunkCount,
  type ShoplingPriceAdjustmentInputResult,
  type ShoplingPriceAdjustmentRow,
} from "@/lib/shoplingPriceAdjustmentInput";

type Selection = {
  label: string;
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

const PLAN_REQUEST_STORAGE_KEY = "shoplingPriceAdjustment.currentPlanRequestId";

const directionLabel = (row: ShoplingPriceAdjustmentRow) => {
  if (row.direction === "increase") return "인상";
  if (row.direction === "decrease") return "인하";
  return "변경 없음";
};

const won = (value: number | undefined) => Number.isFinite(value) ? `${Number(value).toLocaleString("ko-KR")}원` : "-";

export function ShoplingPriceAdjustmentInputPreview() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [sampleSellPrice, setSampleSellPrice] = useState("10003");
  const [sampleRate, setSampleRate] = useState("10");
  const [planRunning, setPlanRunning] = useState(false);
  const [planFetching, setPlanFetching] = useState(false);
  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [planRequestId, setPlanRequestId] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem(PLAN_REQUEST_STORAGE_KEY) ?? "");

  const clearError = () => setError("");
  const applySelection = (next: Selection) => {
    setSelection(next);
    setPlanResponse(null);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReading(true);
    clearError();
    try {
      const result = await parseShoplingPriceAdjustmentFile(file);
      applySelection({ label: file.name, result });
    } catch (caught) {
      setSelection(null);
      setError(caught instanceof Error ? caught.message : "파일을 읽을 수 없습니다.");
    } finally {
      setReading(false);
    }
  };

  const onPaste = (value: string) => {
    clearError();
    try {
      applySelection({ label: "직접 붙여넣기", result: parseShoplingPriceAdjustmentPaste(value) });
    } catch (caught) {
      setSelection(null);
      setError(caught instanceof Error ? caught.message : "입력값을 검사할 수 없습니다.");
    }
  };

  const sample = useMemo(() => {
    try {
      const current = Number(sampleSellPrice.replaceAll(",", ""));
      const adjustmentBps = parseShoplingPriceAdjustmentRateBps(sampleRate);
      return { result: calculateShoplingAdjustedPriceColumns(current, adjustmentBps), error: "" };
    } catch (caught) {
      return { result: null, error: caught instanceof Error ? caught.message : "계산할 수 없습니다." };
    }
  }, [sampleRate, sampleSellPrice]);

  const runReadonlyPlan = async () => {
    if (!selection || planRunning || selection.result.validCount === 0) return;
    const canaryRows = selection.result.rows.slice(0, 10).map((row) => ({ goods_key: row.goodsKey, adjustment_bps: row.adjustmentBps }));
    if (!window.confirm(
      `첫 ${canaryRows.length}개 상품의 현재 판매가와 옵션 추가금을 샵플링 공식 조회 API로 읽습니다.\n` +
      "가격 수정 API는 호출하지 않습니다. 계속하시겠습니까?",
    )) return;
    setPlanRunning(true);
    setPlanResponse(null);
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
      const response = await fetch(`/api/shopling-price-adjustment/plan/result?request_id=${encodeURIComponent(planRequestId)}`, { cache: "no-store" });
      const body = await response.json() as PlanResponse;
      if (!response.ok || body.status === "error") throw new Error(body.message ?? `계획 결과 조회 실패 status=${response.status}`);
      setPlanResponse(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "읽기 전용 계획 결과 조회 중 오류가 발생했습니다.");
    } finally {
      setPlanFetching(false);
    }
  };

  return <div className="space-y-8">
    <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-950">대량 goods_key · 인상/인하율 입력</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            상품별로 서로 다른 인상률·인하율을 최대 20,000개까지 준비합니다. 첫 조회 카나리는 10개, 이후 대량 실행은 최대 50개 직렬 청크 구조로 연결합니다.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">가격 쓰기 차단</span>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border p-4">
          <h3 className="font-bold">CSV·XLSX 업로드</h3>
          <input aria-label="가격 조정 파일 업로드" type="file" accept=".csv,.xlsx" onChange={onFile} className="mt-3 block w-full" />
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            <strong>고정 양식</strong>
            <p>A열: <code>goods_key</code></p>
            <p>B열: <code>adjustment_rate</code></p>
            <p>예: <code>119836,10</code> · <code>119837,-5</code> · <code>119838,7.25%</code></p>
          </div>
        </div>

        <label className="rounded-xl border p-4 font-bold">
          직접 붙여넣기
          <textarea
            aria-label="goods_key와 조정률 직접 붙여넣기"
            onChange={(event) => onPaste(event.target.value)}
            placeholder={"119836 10\n119837 -5\n119838 7.25%"}
            className="mt-3 min-h-44 w-full rounded-lg border p-3 font-mono text-sm"
          />
          <span className="mt-2 block text-sm font-normal leading-6 text-slate-600">한 줄에 상품번호와 조정률을 입력합니다. 공백·탭·쉼표 구분을 지원합니다.</span>
        </label>
      </div>

      {reading && <p className="mt-4 rounded-lg bg-blue-50 p-3 font-semibold text-blue-800">파일을 검사하고 있습니다.</p>}
      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 font-semibold text-red-800">{error}</p>}
      {selection ? <AdjustmentPreview selection={selection} /> : <p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">파일을 업로드하거나 값을 붙여넣으면 실행 전 미리보기가 표시됩니다.</p>}
    </section>

    <section className="rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-950">공식 API 현재가·옵션 읽기 전용 카나리</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">입력 목록의 첫 10개만 조회하여 현재 판매가, 옵션 추가금, 변경 예정가와 24개 쇼핑몰 가격 계획을 만듭니다. 실제 가격은 수정하지 않습니다.</p>
        </div>
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

    <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-950">10원 단위 올림 계산 검산</h2>
      <p className="mt-2 text-sm text-slate-600">현재 판매가를 조정한 뒤 10원 단위로 올리고, 소비자가 1.5배·원가 0.5배를 계산합니다.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">현재 판매가
          <input value={sampleSellPrice} onChange={(event) => setSampleSellPrice(event.target.value)} inputMode="numeric" className="mt-2 w-full rounded-lg border p-3" />
        </label>
        <label className="text-sm font-semibold text-slate-700">인상·인하율
          <input value={sampleRate} onChange={(event) => setSampleRate(event.target.value)} placeholder="10 또는 -5" className="mt-2 w-full rounded-lg border p-3" />
        </label>
      </div>
      {sample.result
        ? <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            <ResultCell label="변경 판매가" value={`${sample.result.sellPrice.toLocaleString("ko-KR")}원`} />
            <ResultCell label="소비자가 (×1.5)" value={`${sample.result.consumerPrice.toLocaleString("ko-KR")}원`} />
            <ResultCell label="원가 (×0.5)" value={`${sample.result.purchasePrice.toLocaleString("ko-KR")}원`} />
          </dl>
        : <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">{sample.error}</p>}
    </section>

    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
      <h2 className="font-bold text-slate-950">현재 안전 경계</h2>
      <p className="mt-2">대량 입력은 최대 20,000개까지 가능하고, 첫 10개는 공식 API로 현재가·옵션을 조회할 수 있습니다. 상품수정 API, 옵션수정 API, 쇼핑몰별 가격수정 API는 아직 연결하지 않았습니다.</p>
      <p className="mt-2">읽기 전용 결과가 실제 샵플링 값과 일치하면 다음 단계에서 단일 상품 쓰기 카나리를 추가한 뒤 기존 10개 카나리·50개 직렬 Bulk 오케스트레이터를 연결합니다.</p>
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
      <div>
        <h3 className="font-bold text-emerald-950">입력 검증 완료</h3>
        <p className="mt-1 text-sm text-slate-600">{selection.label}</p>
      </div>
      <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900">유효 {result.validCount.toLocaleString("ko-KR")}개</span>
    </div>

    <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <ResultCell label="원본 행" value={result.originalCount.toLocaleString("ko-KR")} />
      <ResultCell label="유효 상품" value={result.validCount.toLocaleString("ko-KR")} />
      <ResultCell label="동일 중복 제외" value={result.duplicateCount.toLocaleString("ko-KR")} />
      <ResultCell label="충돌 상품 제외" value={result.conflictCount.toLocaleString("ko-KR")} />
      <ResultCell label="잘못된 행" value={result.invalidCount.toLocaleString("ko-KR")} />
      <ResultCell label="예상 청크" value={`${chunkCount.toLocaleString("ko-KR")}개`} />
      <ResultCell label="첫 시험" value={`최대 ${Math.min(10, result.validCount).toLocaleString("ko-KR")}개`} />
      <ResultCell label="일반 청크" value="최대 50개씩" />
    </dl>

    {result.invalidCount > 0 && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-bold">제외 사유</p>
      <ul className="mt-2 list-disc pl-5">{result.invalid.slice(0, 20).map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul>
      {result.invalid.length > 20 && <p className="mt-2 font-semibold">추가 {result.invalid.length - 20}개는 화면에서 생략했습니다.</p>}
    </div>}

    <AdjustmentTable title="첫 20개" rows={previewRows} />
    {lastRows.length > 0 && <AdjustmentTable title="마지막 5개" rows={lastRows} />}
    {result.rows.length > 25 && <p className="mt-3 text-xs text-slate-500">중간 {(result.rows.length - 25).toLocaleString("ko-KR")}개 상품은 생략했습니다.</p>}
  </div>;
}

function ReadonlyPlanResult({ summary }: { summary: PlanSummary }) {
  const rows = Array.isArray(summary.rows) ? summary.rows : [];
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  return <div className="mt-5 rounded-xl border border-indigo-200 p-5">
    <h3 className="font-bold text-indigo-950">읽기 전용 계획 결과</h3>
    <dl className="mt-4 grid gap-3 sm:grid-cols-4">
      <ResultCell label="상태" value={summary.status ?? "-"} />
      <ResultCell label="요청 상품" value={String(summary.goods_key_count ?? 0)} />
      <ResultCell label="계획 성공" value={String(summary.planned_goods_key_count ?? 0)} />
      <ResultCell label="계획 실패" value={String(summary.failed_goods_key_count ?? 0)} />
      <ResultCell label="예정 쇼핑몰 행" value={String(summary.planned_mall_row_count ?? 0)} />
    </dl>
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead><tr className="border-b bg-slate-50"><th className="p-2">goods_key</th><th className="p-2">조정률</th><th className="p-2">현재 판매가</th><th className="p-2">변경 판매가</th><th className="p-2">현재 옵션 추가금</th><th className="p-2">변경 옵션 추가금</th><th className="p-2">쇼핑몰 행</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr className="border-b" key={row.goods_key ?? index}><td className="p-2 font-mono">{row.goods_key ?? "-"}</td><td className="p-2">{Number(row.adjustment_bps ?? 0) / 100}%</td><td className="p-2">{won(row.current?.sell_price)}</td><td className="p-2 font-bold">{won(row.target?.sell_price)}</td><td className="p-2">{row.current?.option_amounts?.join(", ") || "없음"}</td><td className="p-2 font-bold">{row.target?.option_amounts?.join(", ") || "없음"}</td><td className="p-2">{row.mall_row_count ?? 0}</td></tr>)}</tbody>
      </table>
    </div>
    {errors.length > 0 && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900"><p className="font-bold">계획 실패</p><ul className="mt-2 list-disc pl-5">{errors.map((error, index) => <li key={`${error.goods_key}-${index}`}><code>{error.goods_key || "-"}</code>: {error.error || "원인 없음"}</li>)}</ul></div>}
  </div>;
}

function AdjustmentTable({ title, rows }: { title: string; rows: ShoplingPriceAdjustmentRow[] }) {
  return <div className="mt-5 overflow-x-auto">
    <h4 className="mb-2 font-bold text-slate-900">{title}</h4>
    <table className="w-full min-w-[520px] text-left text-sm">
      <thead><tr className="border-b bg-slate-50"><th className="p-2">goods_key</th><th className="p-2">방향</th><th className="p-2">조정률</th><th className="p-2">내부 정수값</th></tr></thead>
      <tbody>{rows.map((row) => <tr className="border-b" key={row.goodsKey}><td className="p-2 font-mono">{row.goodsKey}</td><td className="p-2">{directionLabel(row)}</td><td className="p-2 font-bold">{row.adjustmentRate}</td><td className="p-2 text-slate-500">{row.adjustmentBps} bps</td></tr>)}</tbody>
    </table>
  </div>;
}

function ResultCell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all font-bold text-slate-950">{value}</dd></div>;
}
