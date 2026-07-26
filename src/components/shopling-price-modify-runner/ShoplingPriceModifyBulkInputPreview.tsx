"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { parseShoplingPriceBulkFile, parseShoplingPriceBulkPaste, plannedShoplingPriceBulkChunkCount, type ShoplingPriceBulkInputResult } from "@/lib/shoplingPriceModifyBulkInput";

type Selection = { label: string; result: ShoplingPriceBulkInputResult };

export function ShoplingPriceModifyBulkInputPreview() {
  const [paste, setPaste] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState("");
  const estimatedRows = (selection?.result.validCount ?? 0) * 24;
  const chunks = plannedShoplingPriceBulkChunkCount(selection?.result.validCount ?? 0);
  const preview = useMemo(() => selection?.result.goodsKeys.slice(0, 20) ?? [], [selection]);
  const tail = useMemo(() => selection && selection.result.goodsKeys.length > 20 ? selection.result.goodsKeys.slice(-5) : [], [selection]);

  const selectPaste = (value: string) => {
    setPaste(value); setError("");
    try { setSelection({ label: "직접 붙여넣기", result: parseShoplingPriceBulkPaste(value) }); }
    catch (caught) { setSelection(null); setError(caught instanceof Error ? caught.message : "입력을 확인할 수 없습니다."); }
  };
  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try { setSelection({ label: file.name, result: await parseShoplingPriceBulkFile(file) }); }
    catch (caught) { setSelection(null); setError(caught instanceof Error ? caught.message : "파일을 확인할 수 없습니다."); }
    finally { event.target.value = ""; }
  };

  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold text-slate-950">대량 가격설정 입력 준비</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">Bulk 실행 전 goods_key 파일과 붙여넣기 형식을 검사합니다. 이번 단계에서는 실제 가격을 수정하지 않습니다.</p>
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-900">엑셀·CSV 업로드</h3>
        <label className="mt-3 block text-sm font-semibold text-slate-700">파일 업로드<input aria-label="Bulk 파일 업로드" type="file" accept=".xlsx,.csv" onChange={selectFile} className="mt-2 block w-full rounded-lg border border-slate-300 p-2 text-sm" /></label>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><strong className="text-slate-800">고정 양식</strong><ul className="mt-2 list-disc space-y-1 pl-5"><li>첫 시트 A열만 사용</li><li>A1: goods_key</li><li>A2부터 상품번호</li><li>B열 이후 데이터 금지</li></ul><p className="mt-2 text-xs">.xlsx 및 .csv, 최대 5MB · 원본 파일은 서버에 전송하지 않습니다.</p></div>
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-900">직접 붙여넣기</h3>
        <p className="mt-2 text-sm text-slate-600">쉼표, 공백, 탭, 줄바꿈을 함께 사용할 수 있습니다.</p>
        <textarea aria-label="goods_key 직접 붙여넣기" value={paste} onChange={(event) => selectPaste(event.target.value)} placeholder={"121031,121032 121033\n121034"} className="mt-3 min-h-40 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </div>
    </div>
    {error ? <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p> : null}
    {selection ? <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
      <p className="text-sm font-semibold text-blue-800">{selection.label} 입력이 현재 미리보기 대상으로 선택되었습니다.</p>
      <h3 className="mt-5 text-lg font-bold text-slate-950">실행 전 미리보기</h3>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="입력 방식" value={sourceLabel(selection.result.source)} /><Metric label="원본 항목 수" value={selection.result.originalCount} /><Metric label="유효 goods_key 수" value={selection.result.validCount} /><Metric label="중복 제거 수" value={selection.result.duplicateCount} /><Metric label="invalid 수" value={selection.result.invalidCount} /><Metric label="최종 대상 수" value={selection.result.goodsKeys.length} /><Metric label="예상 청크 수" value={chunks} /><Metric label="예상 쇼핑몰 가격 수정 행 수" value={estimatedRows} /><Metric label="카나리 크기" value="최대 10" /><Metric label="일반 청크 크기" value="최대 50" />
      </dl>
      {selection.result.invalidCount > 0 ? <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4"><h4 className="font-bold text-amber-900">invalid {selection.result.invalidCount.toLocaleString()}개</h4><ul className="mt-2 max-h-48 overflow-auto font-mono text-sm text-amber-900">{selection.result.invalid.slice(0, 100).map((value, index) => <li key={`${index}-${value}`}>{value || "(빈 값)"}</li>)}</ul>{selection.result.invalidCount > 100 ? <p className="mt-2 text-xs text-amber-800">나머지 {(selection.result.invalidCount - 100).toLocaleString()}개 생략</p> : null}</div> : null}
      <div className="mt-5"><h4 className="font-bold text-slate-900">goods_key 미리보기</h4>{preview.length ? <><ol className="mt-2 grid gap-1 font-mono text-sm sm:grid-cols-2 lg:grid-cols-4">{preview.map((key, index) => <li key={`${index}-${key}`} className="rounded bg-white px-2 py-1">{index + 1}. {key}</li>)}</ol>{selection.result.goodsKeys.length > 20 ? <p className="mt-2 text-xs text-slate-600">중간 {(selection.result.goodsKeys.length - 25 > 0 ? selection.result.goodsKeys.length - 25 : 0).toLocaleString()}개 생략</p> : null}{tail.length ? <div className="mt-3"><p className="text-xs font-semibold text-slate-600">마지막 5개</p><p className="mt-1 font-mono text-sm text-slate-800">{tail.join(", ")}</p></div> : null}</> : <p className="mt-2 text-sm text-slate-500">유효한 goods_key가 없습니다.</p>}</div>
      <p className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Bulk 입력 검증이 완료되었습니다. 이 단계에서는 실제 가격설정을 실행하지 않습니다.</p>
    </div> : <p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">파일을 업로드하거나 goods_key를 직접 붙여넣으면 미리보기가 표시됩니다.</p>}
  </section>;
}

function sourceLabel(source: ShoplingPriceBulkInputResult["source"]) { return source === "paste" ? "직접 붙여넣기" : source.toUpperCase(); }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg border border-slate-200 bg-white p-3"><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-1 text-lg font-bold text-slate-950">{typeof value === "number" ? value.toLocaleString() : value}</dd></div>; }
