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

const directionLabel = (row: ShoplingPriceAdjustmentRow) => {
  if (row.direction === "increase") return "인상";
  if (row.direction === "decrease") return "인하";
  return "변경 없음";
};

export function ShoplingPriceAdjustmentInputPreview() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [sampleSellPrice, setSampleSellPrice] = useState("10003");
  const [sampleRate, setSampleRate] = useState("10");

  const clearError = () => setError("");

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReading(true);
    clearError();
    try {
      const result = await parseShoplingPriceAdjustmentFile(file);
      setSelection({ label: file.name, result });
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
      setSelection({ label: "직접 붙여넣기", result: parseShoplingPriceAdjustmentPaste(value) });
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

  return <div className="space-y-8">
    <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-950">대량 goods_key · 인상/인하율 입력</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            상품별로 서로 다른 인상률·인하율을 최대 20,000개까지 준비합니다. 현재 단계는 입력·계산 검증 전용이며 샵플링 가격은 변경하지 않습니다.
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
      <h2 className="font-bold text-slate-950">이번 단계의 고정 경계</h2>
      <p className="mt-2">대량 입력·중복/충돌 검증·정수 가격 계산까지만 구현합니다. 샵플링 API 조회, 옵션 수정, 쇼핑몰별 가격 수정, GitHub Actions 실행은 아직 연결하지 않습니다.</p>
      <p className="mt-2">다음 단계에서 현재 판매가와 옵션 추가금을 공식 API로 읽어 변경 전 스냅샷과 실제 예정 가격을 생성합니다.</p>
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
  return <div className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-bold text-slate-950">{value}</dd></div>;
}
