"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ManualDraftCandidate[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [addingBarcode, setAddingBarcode] = useState("");
  const [bulkAdding, setBulkAdding] = useState(false);
  const [notice, setNotice] = useState("");

  const selectableCandidates = candidates.filter((candidate) => !candidate.inDraft);
  const selectedCandidates = selectableCandidates.filter(
    (candidate) => selected[candidate.barcode],
  );
  const allSelected =
    selectableCandidates.length > 0 &&
    selectableCandidates.every((candidate) => selected[candidate.barcode]);
  const selectedTotalQuantity = selectedCandidates.reduce(
    (sum, candidate) => sum + quantity(quantities[candidate.barcode] ?? 1),
    0,
  );

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
      setSelected({});
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
      setSelected({});
      setNotice(
        error instanceof Error
          ? error.message
          : "추가할 상품 검색 요청이 일시적으로 실패했습니다.",
      );
    } finally {
      setSearching(false);
    }
  }

  async function postAdd(candidate: ManualDraftCandidate) {
    const addQuantity = quantity(quantities[candidate.barcode]);
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
    return {
      barcode: candidate.barcode,
      targetQuantity: body.targetQuantity ?? addQuantity,
      message: body.message || `${candidate.barcode}를 현재 Draft에 추가했습니다.`,
    };
  }

  function markAdded(rows: Array<{ barcode: string; targetQuantity: number }>) {
    const byBarcode = new Map(rows.map((row) => [row.barcode, row.targetQuantity] as const));
    if (!byBarcode.size) return;
    setCandidates((current) =>
      current.map((candidate) => {
        const targetQuantity = byBarcode.get(candidate.barcode);
        return targetQuantity === undefined
          ? candidate
          : {
              ...candidate,
              inDraft: true,
              currentDraftQuantity: targetQuantity,
            };
      }),
    );
    setSelected((current) => {
      const next = { ...current };
      for (const barcode of byBarcode.keys()) delete next[barcode];
      return next;
    });
  }

  async function add(candidate: ManualDraftCandidate) {
    if (status !== "DRAFT" || bulkAdding) return;
    if (candidate.inDraft) {
      setNotice(
        `${candidate.barcode}는 이미 현재 Draft에 있습니다. 아래 실제 주문표의 수량 칸에서 총 주문수량을 바로 변경하세요.`,
      );
      return;
    }
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
    if (
      !window.confirm(
        `${candidate.barcode} · ${candidate.productName}${candidate.optionName ? ` · ${candidate.optionName}` : ""}\n${addQuantity.toLocaleString("ko-KR")}개를 현재 월간 Draft에 RESERVED로 추가합니다.\n\n추가분은 주문·입고 원장에는 포함되지만 다음 발주추천의 미입고 차감에서는 제외됩니다. 새 Draft를 만들지 않으며 실제 1688 주문·결제는 실행되지 않습니다.`,
      )
    ) {
      return;
    }

    setAddingBarcode(candidate.barcode);
    setNotice("");
    try {
      const result = await postAdd(candidate);
      markAdded([result]);
      setNotice(
        `${result.message} 주문·입고 원장에는 반영하고 다음 발주추천 미입고 차감에서는 제외합니다.`,
      );
      router.refresh();
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

  function toggleAll(checked: boolean) {
    setSelected((current) => {
      const next = { ...current };
      for (const candidate of selectableCandidates) {
        next[candidate.barcode] = checked;
      }
      return next;
    });
  }

  function toggleOne(barcode: string, checked: boolean) {
    setSelected((current) => ({ ...current, [barcode]: checked }));
  }

  async function addSelected() {
    if (status !== "DRAFT" || bulkAdding || addingBarcode) return;
    if (!selectedCandidates.length) {
      setNotice("일괄 반영할 B-code를 체크하세요.");
      return;
    }

    const invalid = selectedCandidates.filter((candidate) => {
      const addQuantity = quantity(quantities[candidate.barcode]);
      return addQuantity < 1 || addQuantity > 9_999;
    });
    if (invalid.length) {
      setNotice(
        `추가수량을 확인하세요: ${invalid.map((candidate) => candidate.barcode).join(", ")}`,
      );
      return;
    }

    const openWarnings = selectedCandidates.filter(
      (candidate) => candidate.otherOpenQuantity > 0,
    );
    const preview = selectedCandidates
      .slice(0, 8)
      .map(
        (candidate) =>
          `${candidate.barcode} ${quantity(quantities[candidate.barcode]).toLocaleString("ko-KR")}개`,
      )
      .join("\n");
    const more =
      selectedCandidates.length > 8
        ? `\n외 ${selectedCandidates.length - 8}건`
        : "";
    const warningText = openWarnings.length
      ? `\n\n주의: 다른 Draft 미입고가 있는 B-code ${openWarnings.length}건 (${openWarnings
          .slice(0, 6)
          .map((candidate) => candidate.barcode)
          .join(", ")}${openWarnings.length > 6 ? " 외" : ""})`
      : "";

    if (
      !window.confirm(
        `선택 ${selectedCandidates.length.toLocaleString("ko-KR")}개 B-code · 총 ${selectedTotalQuantity.toLocaleString("ko-KR")}개를 현재 월간 Draft에 일괄 추가하시겠습니까?\n\n${preview}${more}${warningText}\n\n추가분은 입고원장에 반영하지만 다음 발주추천 미입고 차감에서는 제외합니다. 실제 1688 주문·결제는 실행하지 않습니다.`,
      )
    ) {
      return;
    }

    setBulkAdding(true);
    setNotice(`선택 ${selectedCandidates.length}건 일괄 반영을 시작합니다.`);
    const successes: Array<{ barcode: string; targetQuantity: number }> = [];
    const failures: Array<{ barcode: string; message: string }> = [];

    for (let index = 0; index < selectedCandidates.length; index += 1) {
      const candidate = selectedCandidates[index];
      setNotice(
        `일괄 반영 중 ${index + 1}/${selectedCandidates.length} · ${candidate.barcode}`,
      );
      try {
        const result = await postAdd(candidate);
        successes.push(result);
      } catch (error) {
        failures.push({
          barcode: candidate.barcode,
          message: error instanceof Error ? error.message : "반영 실패",
        });
      }
    }

    markAdded(successes);
    router.refresh();
    setBulkAdding(false);

    if (failures.length) {
      setNotice(
        `일괄 반영 완료: 성공 ${successes.length}건 · 실패 ${failures.length}건. 실패: ${failures
          .slice(0, 5)
          .map((row) => `${row.barcode}(${row.message})`)
          .join(" · ")}${failures.length > 5 ? " · 외 실패건 있음" : ""}`,
      );
    } else {
      setNotice(
        `선택 ${successes.length}건 · 총 ${selectedTotalQuantity.toLocaleString("ko-KR")}개를 현재 Draft에 일괄 반영했습니다. 입고원장에는 포함하고 다음 발주추천 미입고 차감에서는 제외합니다.`,
      );
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
            예산이 남거나 같은 모델의 다른 색상·옵션을 실제로 더 주문할 때 사용합니다. 현재 Draft에 없는 활성 B-code를 검색해 이 월간 Draft 한 건에 추가합니다. 여러 옵션은 체크박스로 선택해 한 번에 반영할 수 있습니다. 이미 들어온 B-code는 아래 실제 주문표의 수량 칸에서 바로 총수량을 변경합니다.
          </p>
        </div>
        <span className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-800">
          입고원장 반영 · 다음 발주차감 제외
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
              placeholder="B-code / 모델번호 / 상품명 / 옵션명 검색 · 예: 토끼브로치, BBA2-2, aaa092"
              className="min-w-0 flex-1 rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={searching || bulkAdding}
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
            <div className="mt-4 overflow-hidden rounded-xl border border-amber-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/70 px-4 py-3">
                <div className="text-sm font-bold text-slate-700">
                  선택 <strong className="text-amber-800">{selectedCandidates.length}건</strong>
                  {selectedCandidates.length ? (
                    <span> · 총 {selectedTotalQuantity.toLocaleString("ko-KR")}개</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void addSelected()}
                  disabled={!selectedCandidates.length || bulkAdding || Boolean(addingBarcode)}
                  className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-black text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {bulkAdding
                    ? "선택항목 반영 중..."
                    : `선택 ${selectedCandidates.length}건 일괄 반영`}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[1040px] w-full text-left text-xs">
                  <thead className="border-b border-amber-100 bg-amber-50 font-black text-slate-600">
                    <tr>
                      <th className="w-14 px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          disabled={!selectableCandidates.length || bulkAdding}
                          onChange={(event) => toggleAll(event.target.checked)}
                          aria-label="추가 가능한 B-code 전체선택"
                          className="h-4 w-4 accent-amber-600"
                        />
                      </th>
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
                        <td className="px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(selected[candidate.barcode]) && !candidate.inDraft}
                            disabled={candidate.inDraft || bulkAdding || Boolean(addingBarcode)}
                            onChange={(event) =>
                              toggleOne(candidate.barcode, event.target.checked)
                            }
                            aria-label={`${candidate.barcode} 일괄 추가 선택`}
                            className="h-4 w-4 accent-amber-600"
                          />
                        </td>
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
                            disabled={candidate.inDraft || bulkAdding}
                            onChange={(event) =>
                              setQuantities((current) => ({
                                ...current,
                                [candidate.barcode]: quantity(event.target.value),
                              }))
                            }
                            className="w-28 rounded-lg border border-amber-300 px-3 py-2 text-right font-black text-slate-900 outline-none focus:border-amber-500 disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => void add(candidate)}
                            disabled={
                              addingBarcode === candidate.barcode ||
                              candidate.inDraft ||
                              bulkAdding
                            }
                            className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 font-black text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
                          >
                            {addingBarcode === candidate.barcode
                              ? "반영 중..."
                              : candidate.inDraft
                                ? "주문표 수량 조정"
                                : "현재 Draft에 추가"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
