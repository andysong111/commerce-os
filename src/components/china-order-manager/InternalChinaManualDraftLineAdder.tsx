"use client";

import { FormEvent, useState } from "react";

export type ManualDraftCandidate = {
  barcode: string;
  modelNo: string;
  productName: string;
  optionName: string;
  inDraft: boolean;
  currentDraftQuantity: number;
  otherOpenQuantity: number;
};

type SearchResponse = {
  ok?: boolean;
  message?: string;
  candidates?: ManualDraftCandidate[];
};

type AddResponse = {
  ok?: boolean;
  message?: string;
  addedQuantity?: number;
  targetQuantity?: number;
  otherOpenQuantity?: number;
};

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function requestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function InternalChinaManualDraftLineAdder({
  draftId,
  status,
}: {
  draftId: string;
  status: "DRAFT" | "ORDERED";
}) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ManualDraftCandidate[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [searching, setSearching] = useState(false);
  const [addingBarcode, setAddingBarcode] = useState("");
  const [notice, setNotice] = useState("");

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setNotice("B-code·모델번호·상품명·옵션명을 2글자 이상 입력하세요.");
      return;
    }
    setSearching(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draftId)}/manual-lines?q=${encodeURIComponent(trimmed)}`,
        {
          method: "GET",
          headers: { accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as SearchResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "추가할 상품 검색에 실패했습니다.");
      }
      const next = body.candidates ?? [];
      setCandidates(next);
      setQuantities((current) => {
        const output = { ...current };
        for (const candidate of next) {
          if (!output[candidate.barcode]) output[candidate.barcode] = 1;
        }
        return output;
      });
      setNotice(body.message || "검색을 완료했습니다.");
    } catch (error) {
      setCandidates([]);
      setNotice(
        error instanceof Error
          ? error.message
          : "추가할 상품 검색 요청이 일시적으로 실패했습니다.",
      );
    } finally {
      setSearching(false);
    }
  }

  async function add(candidate: ManualDraftCandidate) {
    if (status !== "DRAFT") return;
    const addQuantity = quantity(quantities[candidate.barcode]);
    if (addQuantity < 1 || addQuantity > 9_999) {
      setNotice("추가수량은 1개 이상 9,999개 이하로 입력하세요.");
      return;
    }
    if (
      candidate.otherOpenQuantity > 0 &&
      !window.confirm(
        `${candidate.barcode}는 현재 Draft 밖에 미입고 ${candidate.otherOpenQuantity.toLocaleString("ko-KR")}개가 있습니다.\n\n그래도 이번 월간 Draft에 ${addQuantity.toLocaleString("ko-KR")}개를 추가하시겠습니까?`,
      )
    ) {
      return;
    }
    const currentAfter = candidate.currentDraftQuantity + addQuantity;
    if (
      !window.confirm(
        candidate.inDraft
          ? `${candidate.barcode}는 현재 Draft에 ${candidate.currentDraftQuantity.toLocaleString("ko-KR")}개가 있습니다.\n추가 ${addQuantity.toLocaleString("ko-KR")}개 → 총 ${currentAfter.toLocaleString("ko-KR")}개 RESERVED로 변경합니다.\n\n실제 1688 주문·결제는 실행되지 않습니다.`
          : `${candidate.barcode} · ${candidate.productName}${candidate.optionName ? ` · ${candidate.optionName}` : ""}\n${addQuantity.toLocaleString("ko-KR")}개를 현재 월간 Draft에 RESERVED로 추가합니다.\n\n새 Draft를 만들지 않으며 실제 1688 주문·결제는 실행되지 않습니다.`,
      )
    ) {
      return;
    }

    setAddingBarcode(candidate.barcode);
    setNotice("");
    try {
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draftId)}/manual-lines`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            barcode: candidate.barcode,
            addQuantity,
            requestId: requestId(),
          }),
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as AddResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "현재 월간 Draft에 품목을 추가하지 못했습니다.");
      }
      setNotice(`${body.message || "현재 Draft에 추가했습니다."} 화면을 갱신합니다.`);
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "현재 월간 Draft 품목 추가 요청이 일시적으로 실패했습니다.",
      );
    } finally {
      setAddingBarcode("");
    }
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-amber-700">
            MONTHLY DRAFT · MANUAL ADD
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">주문품목 추가</h2>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-700">
            예산이 남거나 같은 모델의 다른 색상·옵션을 실제로 더 주문할 때 사용합니다. 기존 B-code를 검색해 현재 월간 Draft 한 건에 바로 추가하며 새 Draft는 만들지 않습니다. 추가 수량은 즉시 RESERVED 미입고 약정에 반영되어 다음 발주 계산에서 중복 주문을 막습니다.
          </p>
        </div>
        <span className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-800">
          실제 1688 주문 실행 없음
        </span>
      </div>

      {status !== "DRAFT" ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">
          실제 주문 기록이 시작된 Draft라 추가 기능을 잠갔습니다.
        </div>
      ) : (
        <>
          <form onSubmit={(event) => void search(event)} className="mt-4 flex flex-col gap-2 md:flex-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="B-code / 모델번호 / 상품명 / 옵션명 검색 · 예: BCA5-1, aaa100"
              className="min-w-0 flex-1 rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={searching}
              className="rounded-xl bg-amber-600 px-5 py-3 text-sm font-black text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searching ? "검색 중..." : "추가할 B-code 검색"}
            </button>
          </form>

          {notice ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-bold text-slate-800">
              {notice}
            </div>
          ) : null}

          {candidates.length ? (
            <div className="mt-4 overflow-x-auto rounded-xl border border-amber-200 bg-white">
              <table className="min-w-[980px] w-full text-left text-xs">
                <thead className="border-b border-amber-100 bg-amber-50 font-black text-slate-600">
                  <tr>
                    <th className="px-3 py-3">B-code</th>
                    <th className="px-3 py-3">모델번호</th>
                    <th className="px-3 py-3">상품 / 옵션</th>
                    <th className="px-3 py-3 text-right">현재 Draft</th>
                    <th className="px-3 py-3 text-right">다른 미입고</th>
                    <th className="px-3 py-3 text-right">추가수량</th>
                    <th className="px-3 py-3">반영</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {candidates.map((candidate) => (
                    <tr key={candidate.barcode} className="align-middle">
                      <td className="px-3 py-3 font-black text-slate-950">{candidate.barcode}</td>
                      <td className="px-3 py-3 font-semibold text-slate-700">{candidate.modelNo || "-"}</td>
                      <td className="max-w-[360px] px-3 py-3">
                        <strong className="block text-slate-900">{candidate.productName}</strong>
                        <span className="mt-1 block text-slate-500">옵션 · {candidate.optionName || "단품"}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-slate-700">
                        {candidate.inDraft ? `${candidate.currentDraftQuantity.toLocaleString("ko-KR")}개` : "없음"}
                      </td>
                      <td className={`px-3 py-3 text-right font-black ${candidate.otherOpenQuantity > 0 ? "text-rose-700" : "text-slate-400"}`}>
                        {candidate.otherOpenQuantity > 0 ? `${candidate.otherOpenQuantity.toLocaleString("ko-KR")}개` : "0"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          type="number"
                          min={1}
                          max={9999}
                          value={quantities[candidate.barcode] ?? 1}
                          onChange={(event) =>
                            setQuantities((current) => ({
                              ...current,
                              [candidate.barcode]: quantity(event.target.value),
                            }))
                          }
                          className="w-28 rounded-lg border border-amber-300 px-3 py-2 text-right font-black text-slate-900 outline-none focus:border-amber-500"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => void add(candidate)}
                          disabled={addingBarcode === candidate.barcode}
                          className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 font-black text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {addingBarcode === candidate.barcode
                            ? "반영 중..."
                            : candidate.inDraft
                              ? "추가수량 반영"
                              : "현재 Draft에 추가"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
