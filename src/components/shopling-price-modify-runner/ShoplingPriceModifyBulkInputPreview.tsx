"use client";

import { ChangeEvent, useState } from "react";
import { parseShoplingPriceBulkFile, parseShoplingPriceBulkPaste, plannedShoplingPriceBulkChunkCount, type ShoplingPriceBulkInputResult } from "@/lib/shoplingPriceModifyBulkInput";

type Selection = { label: string; result: ShoplingPriceBulkInputResult };

export function ShoplingPriceModifyBulkInputPreview() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReading(true); setError("");
    try { setSelection({ label: file.name, result: await parseShoplingPriceBulkFile(file) }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "파일을 읽을 수 없습니다."); }
    finally { setReading(false); }
  };
  const onPaste = (value: string) => {
    setError("");
    try { setSelection({ label: "직접 붙여넣기", result: parseShoplingPriceBulkPaste(value) }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "입력을 검사할 수 없습니다."); }
  };
  return <section className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold text-slate-950">대량 가격설정 입력 준비</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">Bulk 실행 전 goods_key 파일과 붙여넣기 형식을 검사합니다. 이번 단계에서는 실제 가격을 수정하지 않습니다.</p>
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-900">엑셀·CSV 업로드</h3>
        <label className="mt-3 block text-sm font-semibold text-slate-700">파일 업로드<input type="file" accept=".xlsx,.csv" onChange={onFile} className="mt-2 block w-full rounded-lg border border-slate-300 p-2 text-sm" /></label>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600"><strong className="text-slate-800">고정 양식</strong><ul className="list-disc pl-5"><li>첫 시트 A열만 사용</li><li>A1: goods_key</li><li>A2부터 상품번호</li><li>B열 이후 데이터 금지</li></ul><p className="mt-2 text-xs">CSV도 goods_key 한 열만 사용할 수 있으며, 파일은 서버에 전송하지 않습니다. 최대 5MB.</p></div>
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <label className="block font-bold text-slate-900">직접 붙여넣기<textarea onChange={(event) => onPaste(event.target.value)} placeholder={"121031,121032 121033\n121034"} className="mt-3 min-h-40 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" /></label>
        <p className="mt-2 text-sm text-slate-600">쉼표, 공백, 탭, 줄바꿈을 함께 사용할 수 있습니다.</p>
      </div>
    </div>
    {reading ? <p className="mt-5 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">파일을 검사하고 있습니다.</p> : null}
    {error ? <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
    {selection ? <Preview selection={selection} /> : <p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">파일을 업로드하거나 goods_key를 붙여넣으면 실행 전 미리보기가 표시됩니다.</p>}
  </section>;
}

function Preview({ selection }: { selection: Selection }) {
  const { result } = selection;
  const first = result.goodsKeys.slice(0, 20);
  const last = result.goodsKeys.length > 20 ? result.goodsKeys.slice(-5) : [];
  const rows = [
    ["입력 방식", result.source === "paste" ? "직접 붙여넣기" : result.source.toUpperCase()], ["원본 항목 수", result.originalCount], ["유효 goods_key 수", result.validCount],
    ["중복 제거 수", result.duplicateCount], ["invalid 수", result.invalidCount], ["최종 대상 수", result.goodsKeys.length], ["예상 청크 수", plannedShoplingPriceBulkChunkCount(result.goodsKeys.length)],
    ["예상 쇼핑몰 가격 수정 행 수", result.goodsKeys.length * 24], ["카나리 크기", "최대 10"], ["일반 청크 크기", "최대 50"],
  ];
  return <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/40 p-5">
    <h3 className="font-bold text-slate-950">실행 전 미리보기</h3>
    <p className="mt-2 text-sm font-medium text-blue-800">{selection.label} 입력이 현재 미리보기 대상으로 선택되었습니다.</p>
    <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{rows.map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-1 text-lg font-bold text-slate-900">{Number.isFinite(value) ? Number(value).toLocaleString("ko-KR") : value}</dd></div>)}</dl>
    <div className="mt-5 grid gap-4 lg:grid-cols-2"><PreviewList title="goods_key 미리보기 (첫 20개)" values={first} />{last.length ? <PreviewList title="마지막 5개" values={last} /> : null}</div>
    {result.goodsKeys.length > 20 ? <p className="mt-2 text-xs text-slate-600">중간 {Math.max(0, result.goodsKeys.length - 25).toLocaleString("ko-KR")}개 항목은 생략했습니다.</p> : null}
    {result.invalidCount ? <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4"><h4 className="font-bold text-amber-900">invalid {result.invalidCount.toLocaleString("ko-KR")}개</h4><p className="mt-1 text-xs text-amber-800">아래 목록은 최대 100개까지 표시합니다.</p><ul className="mt-2 max-h-48 overflow-auto font-mono text-sm text-amber-900">{result.invalid.slice(0, 100).map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul></div> : null}
    <p className="mt-5 rounded-lg bg-emerald-100 p-3 text-sm font-semibold text-emerald-800">Bulk 입력 검증이 완료되었습니다. 이 단계에서는 실제 가격설정을 실행하지 않습니다.</p>
  </div>;
}

function PreviewList({ title, values }: { title: string; values: string[] }) { return <div className="rounded-lg bg-white p-4"><h4 className="text-sm font-bold text-slate-800">{title}</h4>{values.length ? <ol className="mt-2 max-h-64 list-decimal overflow-auto pl-6 font-mono text-sm text-slate-700">{values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ol> : <p className="mt-2 text-sm text-slate-500">대상이 없습니다.</p>}</div>; }
