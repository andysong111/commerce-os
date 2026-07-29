"use client";

import { useMemo, useState } from "react";
import { parseShoplingPriceAdjustmentRateBps } from "@/lib/shoplingPriceAdjustmentInput";
import {
  applyShoplingIndividualBulkRate,
  parseShoplingIndividualDraft,
  serializeShoplingIndividualDraft,
  type ShoplingIndividualDraftRow,
} from "@/lib/shoplingPriceAdjustmentIndividualEditor";

const PAGE_SIZE = 50;
const TARGET_TEXTAREA_LABEL = "goods_key와 조정률 직접 붙여넣기";

function updateReactTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("개별 설정 입력칸을 갱신할 수 없습니다.");
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

export function ShoplingPriceAdjustmentIndividualBulkEditor() {
  const [rawInput, setRawInput] = useState("");
  const [rows, setRows] = useState<ShoplingIndividualDraftRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRate, setBulkRate] = useState("10");
  const [invalidLines, setInvalidLines] = useState<string[]>([]);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedCount = selected.size;

  const validation = useMemo(() => {
    let missingCount = 0;
    const invalidRates: string[] = [];
    for (const row of rows) {
      if (!row.rateText.trim()) {
        missingCount += 1;
        continue;
      }
      try { parseShoplingPriceAdjustmentRateBps(row.rateText); }
      catch { invalidRates.push(row.goodsKey); }
    }
    return { missingCount, invalidRates };
  }, [rows]);

  const buildList = () => {
    setError("");
    setMessage("");
    try {
      const parsed = parseShoplingIndividualDraft(rawInput);
      setRows(parsed.rows);
      setSelected(new Set(parsed.rows.map((row) => row.goodsKey)));
      setInvalidLines(parsed.invalid);
      setDuplicateCount(parsed.duplicateCount);
      setPage(1);
      setMessage(parsed.rows.length > 0
        ? `${parsed.rows.length.toLocaleString("ko-KR")}개 상품 목록을 만들었습니다. 기본값으로 전체 선택되어 있습니다.`
        : "유효한 goods_key가 없습니다.");
    } catch (caught) {
      setRows([]);
      setSelected(new Set());
      setError(caught instanceof Error ? caught.message : "상품 목록을 만들 수 없습니다.");
    }
  };

  const setRowRate = (goodsKey: string, rateText: string) => {
    setRows((current) => current.map((row) => row.goodsKey === goodsKey ? { ...row, rateText } : row));
    setMessage("");
  };

  const toggleSelected = (goodsKey: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(goodsKey)) next.delete(goodsKey);
      else next.add(goodsKey);
      return next;
    });
  };

  const selectVisible = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of visibleRows) checked ? next.add(row.goodsKey) : next.delete(row.goodsKey);
      return next;
    });
  };

  const applyBulkRate = (all: boolean) => {
    setError("");
    setMessage("");
    try {
      parseShoplingPriceAdjustmentRateBps(bulkRate);
      if (!all && selected.size === 0) throw new Error("조정률을 반영할 상품을 체크하세요.");
      setRows((current) => applyShoplingIndividualBulkRate(current, selected, bulkRate, all));
      setMessage(all
        ? `전체 ${rows.length.toLocaleString("ko-KR")}개 상품에 ${bulkRate}%를 반영했습니다.`
        : `선택한 ${selected.size.toLocaleString("ko-KR")}개 상품에 ${bulkRate}%를 반영했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "조정률을 반영할 수 없습니다.");
    }
  };

  const removeSelected = () => {
    if (selected.size === 0) return;
    setRows((current) => current.filter((row) => !selected.has(row.goodsKey)));
    setSelected(new Set());
    setPage(1);
    setMessage(`선택한 ${selected.size.toLocaleString("ko-KR")}개 상품을 목록에서 제거했습니다.`);
  };

  const transferToIndividualInput = () => {
    setError("");
    setMessage("");
    if (rows.length === 0) {
      setError("먼저 goods_key 목록을 만드세요.");
      return;
    }
    if (validation.missingCount > 0 || validation.invalidRates.length > 0) {
      setError(`미입력 ${validation.missingCount}개, 잘못된 조정률 ${validation.invalidRates.length}개를 먼저 수정하세요.`);
      return;
    }

    const formatted = serializeShoplingIndividualDraft(rows);
    const individualButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim().startsWith("개별 설정"));
    individualButton?.click();

    window.setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${TARGET_TEXTAREA_LABEL}"]`);
      if (!textarea) {
        setError("개별 설정 입력칸을 찾지 못했습니다. 아래에서 개별 설정을 선택한 뒤 다시 반영하세요.");
        return;
      }
      updateReactTextarea(textarea, formatted);
      textarea.scrollIntoView({ behavior: "smooth", block: "center" });
      textarea.focus();
      setMessage(`${rows.length.toLocaleString("ko-KR")}개 상품을 아래 개별 설정 입력칸에 반영했습니다.`);
    }, 50);
  };

  const visibleAllChecked = visibleRows.length > 0 && visibleRows.every((row) => selected.has(row.goodsKey));
  const ready = rows.length > 0 && validation.missingCount === 0 && validation.invalidRates.length === 0;

  return <section className="mb-8 rounded-2xl border-2 border-violet-300 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-slate-950">개별 설정 빠른 편집</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">goods_key만 붙여넣고 체크한 상품에 같은 조정률을 한 번에 적용합니다. 상품별 조정률도 표에서 직접 바꿀 수 있습니다.</p>
      </div>
      <span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-bold text-violet-900">체크박스 일괄반영</span>
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
      <label className="block font-bold text-slate-800">goods_key 목록
        <textarea value={rawInput} onChange={(event) => setRawInput(event.target.value)} placeholder={"102759\n102758\n102755\n\n기존처럼 102754 10 형식도 가능"} className="mt-2 min-h-40 w-full rounded-xl border border-slate-300 p-3 font-mono text-sm" />
        <span className="mt-2 block text-sm font-normal text-slate-600">한 줄에 goods_key만 입력해도 됩니다. 이미 조정률이 있으면 두 번째 값으로 함께 입력할 수 있습니다.</span>
      </label>
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
        <button type="button" onClick={buildList} className="w-full rounded-lg bg-violet-700 px-4 py-3 font-bold text-white">체크박스 목록 만들기</button>
        <label className="mt-4 block text-sm font-bold text-slate-800">일괄 반영할 인상·인하율
          <input value={bulkRate} onChange={(event) => setBulkRate(event.target.value)} placeholder="예: 10 또는 -5" className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={rows.length === 0 || selectedCount === 0} onClick={() => applyBulkRate(false)} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">체크 상품에 반영</button>
          <button type="button" disabled={rows.length === 0} onClick={() => applyBulkRate(true)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">전체에 반영</button>
          <button type="button" disabled={rows.length === 0} onClick={() => setSelected(new Set(rows.map((row) => row.goodsKey)))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold">전체 선택</button>
          <button type="button" disabled={selectedCount === 0} onClick={() => setSelected(new Set())} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-40">전체 해제</button>
        </div>
      </div>
    </div>

    {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>}
    {message && <p className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">{message}</p>}
    {(invalidLines.length > 0 || duplicateCount > 0) && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-bold">입력 정리 결과</p>
      <p className="mt-1">동일 goods_key 중복 제외: {duplicateCount.toLocaleString("ko-KR")}개 · 잘못된 행: {invalidLines.length.toLocaleString("ko-KR")}개</p>
      {invalidLines.length > 0 && <ul className="mt-2 list-disc pl-5">{invalidLines.slice(0, 10).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>}
    </div>}

    {rows.length > 0 && <>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4 text-sm">
        <p><strong>상품 {rows.length.toLocaleString("ko-KR")}개</strong> · 선택 {selectedCount.toLocaleString("ko-KR")}개 · 미입력 {validation.missingCount.toLocaleString("ko-KR")}개 · 잘못된 조정률 {validation.invalidRates.length.toLocaleString("ko-KR")}개</p>
        <button type="button" disabled={selectedCount === 0} onClick={removeSelected} className="rounded-lg border border-red-300 bg-white px-3 py-2 font-bold text-red-700 disabled:opacity-40">선택 상품 제거</button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="p-3"><input type="checkbox" checked={visibleAllChecked} onChange={(event) => selectVisible(event.target.checked)} aria-label="현재 페이지 전체 선택" /></th>
            <th className="p-3">번호</th><th className="p-3">goods_key</th><th className="p-3">인상·인하율</th><th className="p-3">상태</th>
          </tr></thead>
          <tbody>{visibleRows.map((row, index) => {
            let rateState = "입력 필요";
            let valid = false;
            if (row.rateText.trim()) {
              try { parseShoplingPriceAdjustmentRateBps(row.rateText); rateState = "정상"; valid = true; }
              catch { rateState = "형식 오류"; }
            }
            return <tr className="border-t" key={row.goodsKey}>
              <td className="p-3"><input type="checkbox" checked={selected.has(row.goodsKey)} onChange={() => toggleSelected(row.goodsKey)} aria-label={`${row.goodsKey} 선택`} /></td>
              <td className="p-3 text-slate-500">{((page - 1) * PAGE_SIZE + index + 1).toLocaleString("ko-KR")}</td>
              <td className="p-3 font-mono font-semibold">{row.goodsKey}</td>
              <td className="p-3"><input value={row.rateText} onChange={(event) => setRowRate(row.goodsKey, event.target.value)} placeholder="10 또는 -5" className="w-40 rounded-lg border p-2" /></td>
              <td className={`p-3 font-semibold ${valid ? "text-emerald-700" : "text-amber-700"}`}>{rateState}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      {pageCount > 1 && <div className="mt-4 flex items-center justify-center gap-3">
        <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border px-3 py-2 font-bold disabled:opacity-40">이전</button>
        <span className="text-sm font-semibold">{page.toLocaleString("ko-KR")} / {pageCount.toLocaleString("ko-KR")}</span>
        <button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="rounded-lg border px-3 py-2 font-bold disabled:opacity-40">다음</button>
      </div>}

      <div className="mt-5 rounded-xl border-2 border-violet-300 bg-violet-50 p-4">
        <button type="button" disabled={!ready} onClick={transferToIndividualInput} className="w-full rounded-lg bg-violet-800 px-5 py-3 font-bold text-white disabled:opacity-40">{ready ? `${rows.length.toLocaleString("ko-KR")}개를 개별 설정 입력칸에 반영` : "모든 상품의 조정률을 입력하세요"}</button>
        <p className="mt-2 text-center text-xs text-violet-900">반영하면 아래 기존 개별 설정 입력칸과 검증 결과가 자동 갱신됩니다. 아직 실제 가격은 변경되지 않습니다.</p>
      </div>
    </>}
  </section>;
}
