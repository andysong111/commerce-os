"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_QUANTITY = 9_999;

type DraftLine = {
  barcode: string;
  requestedQuantity: number;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  status: string;
};

type Draft = {
  draftId: string;
  cycleMonth: string;
  createdAt: string;
  lineCount: number;
  requestedQuantity: number;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  updatedAt: string;
  lines: DraftLine[];
};

type DisplayMetadata = {
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
};

type Entry = {
  selected: boolean;
  quantity: number;
};

function monthLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1])}년 ${Number(match[2])}월` : value;
}

function shortDraft(value: string) {
  return value.replace("fast-purchase-draft:", "").slice(0, 8);
}

function chooseDefaultBase(drafts: Draft[]) {
  return [...drafts].sort(
    (left, right) =>
      right.openQuantity - left.openQuantity ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )[0]?.draftId ?? "";
}

function buildRows(drafts: Draft[]) {
  const byBarcode = new Map<
    string,
    Array<{ draftId: string; quantity: number; status: string }>
  >();
  for (const draft of drafts) {
    for (const line of draft.lines) {
      if (line.openQuantity <= 0) continue;
      const list = byBarcode.get(line.barcode) ?? [];
      list.push({
        draftId: draft.draftId,
        quantity: line.openQuantity,
        status: line.status,
      });
      byBarcode.set(line.barcode, list);
    }
  }
  return [...byBarcode.entries()]
    .map(([barcode, sources]) => ({
      barcode,
      sources: sources.sort((left, right) =>
        left.draftId.localeCompare(right.draftId),
      ),
      maxQuantity: Math.max(...sources.map((source) => source.quantity)),
    }))
    .sort((left, right) => left.barcode.localeCompare(right.barcode));
}

function initialEntries(
  rows: ReturnType<typeof buildRows>,
  baseDraftId: string,
) {
  return Object.fromEntries(
    rows.map((row) => {
      const base = row.sources.find((source) => source.draftId === baseDraftId);
      return [
        row.barcode,
        {
          selected: Boolean(base),
          quantity: base?.quantity ?? row.maxQuantity,
        } satisfies Entry,
      ];
    }),
  ) as Record<string, Entry>;
}

export function MonthlyDraftConsolidation({
  drafts,
  metadataByBarcode = {},
}: {
  drafts: Draft[];
  metadataByBarcode?: Record<string, DisplayMetadata>;
}) {
  const router = useRouter();
  const rows = useMemo(() => buildRows(drafts), [drafts]);
  const defaultBase = useMemo(() => chooseDefaultBase(drafts), [drafts]);
  const [baseDraftId, setBaseDraftId] = useState(defaultBase);
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    initialEntries(rows, defaultBase),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  if (drafts.length < 2) return null;

  const cycleMonth = drafts[0]?.cycleMonth ?? "";
  const unsafe = drafts.some(
    (draft) =>
      draft.orderedQuantity > 0 ||
      draft.receivedQuantity > 0 ||
      draft.lines.some(
        (line) => line.openQuantity > 0 && line.status !== "RESERVED",
      ),
  );
  const selectedRows = rows.filter((row) => entries[row.barcode]?.selected);
  const selectedUnits = selectedRows.reduce(
    (sum, row) => sum + (entries[row.barcode]?.quantity ?? 0),
    0,
  );
  const extraCandidates = rows.filter(
    (row) => !row.sources.some((source) => source.draftId === baseDraftId),
  ).length;
  const duplicateBarcodes = rows.filter((row) => row.sources.length > 1).length;

  const resetForBase = (nextBase: string) => {
    setBaseDraftId(nextBase);
    setEntries(initialEntries(rows, nextBase));
    setNotice("");
  };

  const updateEntry = (barcode: string, patch: Partial<Entry>) => {
    setEntries((current) => ({
      ...current,
      [barcode]: {
        selected: current[barcode]?.selected ?? false,
        quantity: current[barcode]?.quantity ?? 0,
        ...patch,
      },
    }));
  };

  const finalize = async () => {
    setNotice("");
    if (unsafe) {
      setNotice(
        "이미 주문 전송·실주문·입고 단계로 진행된 Draft가 있어 자동 통합할 수 없습니다.",
      );
      return;
    }
    const lines = selectedRows.map((row) => ({
      barcode: row.barcode,
      plannedQuantity: Math.min(
        MAX_QUANTITY,
        Math.max(0, Math.round(entries[row.barcode]?.quantity ?? 0)),
      ),
    }));
    if (!lines.length || lines.some((line) => line.plannedQuantity <= 0)) {
      setNotice("최종 발주에 포함할 B-code와 수량을 확인하세요.");
      return;
    }
    if (
      !window.confirm(
        `${monthLabel(cycleMonth)} 활성 Draft ${drafts.length}건을 하나로 정리할까요?\n\n최종 ${lines.length} SKU · ${selectedUnits.toLocaleString("ko-KR")}개로 새 RESERVED Draft를 만들고, 기존 Draft의 미입고 약정은 CANCELLED로 닫습니다. 실제 1688 주문·결제는 실행하지 않습니다.`,
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        "/api/china-order-manager/monthly-finalize",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ cycleMonth, baseDraftId, lines }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        result?: { finalDraftId?: string };
      };
      if (!response.ok || !payload.ok || !payload.result?.finalDraftId) {
        setNotice(payload.message || "월간 최종 Draft 정리에 실패했습니다.");
        return;
      }
      setNotice(payload.message || "월간 최종 Draft 정리를 완료했습니다.");
      router.push(
        `/china-order-manager/drafts/${encodeURIComponent(payload.result.finalDraftId)}`,
      );
      router.refresh();
    } catch {
      setNotice(
        "월간 최종 Draft 저장 요청이 일시적으로 실패했습니다. 기존 Draft와 실제 주문에는 변화가 없습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-amber-800">
            MONTHLY FINAL PURCHASE DRAFT
          </span>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            {monthLabel(cycleMonth)} 활성 Draft를 1건으로 정리
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            과거 개발 과정에서 같은 달에 여러 Draft가 생겼습니다. 가장 큰 Draft를
            기준으로 자동 선택하고, 다른 Draft에만 있는 B-code는 기본 제외한 채
            추가 후보로 보여줍니다. 최종화하면 기존 미입고 약정은 닫히고 선택한
            수량만 새 월간 RESERVED Draft로 남습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={finalize}
          disabled={saving || unsafe}
          className="rounded-xl bg-amber-700 px-5 py-3 text-sm font-black text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "월간 최종 Draft 정리 중..." : "선택 수량으로 월간 최종화"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Metric label="활성 Draft" value={`${drafts.length}건`} />
        <Metric label="통합 B-code" value={`${rows.length}개`} />
        <Metric label="중복 B-code" value={`${duplicateBarcodes}개`} />
        <Metric
          label="기준 밖 추가후보"
          value={`${extraCandidates}개`}
        />
      </div>

      <label className="mt-4 block max-w-xl text-sm font-bold text-slate-700">
        기준 Draft
        <select
          value={baseDraftId}
          onChange={(event) => resetForBase(event.target.value)}
          className="mt-2 w-full rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-sm"
        >
          {[...drafts]
            .sort((left, right) => right.openQuantity - left.openQuantity)
            .map((draft) => (
              <option key={draft.draftId} value={draft.draftId}>
                {shortDraft(draft.draftId)} · {draft.lineCount} SKU · {draft.openQuantity.toLocaleString("ko-KR")}개
              </option>
            ))}
        </select>
      </label>

      {unsafe ? (
        <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
          일부 Draft가 RESERVED 이후 단계로 진행되었습니다. 자동 취소·통합하지 않고
          운영자 확인이 필요합니다.
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-amber-200 bg-white">
        <table className="min-w-[1260px] w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-500">
            <tr>
              <th className="px-3 py-3">포함</th>
              <th className="px-3 py-3">B-code · 모델번호 · 모델명 · 옵션명</th>
              <th className="px-3 py-3">기준 Draft</th>
              <th className="px-3 py-3">기존 Draft별 미입고</th>
              <th className="px-3 py-3 text-right">최종 수량</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const entry = entries[row.barcode] ?? {
                selected: false,
                quantity: row.maxQuantity,
              };
              const base = row.sources.find(
                (source) => source.draftId === baseDraftId,
              );
              const metadata = metadataByBarcode[row.barcode];
              return (
                <tr key={row.barcode} className={entry.selected ? "" : "bg-slate-50/70"}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={entry.selected}
                      onChange={(event) =>
                        updateEntry(row.barcode, { selected: event.target.checked })
                      }
                      aria-label={`${row.barcode} 최종 발주 포함`}
                    />
                  </td>
                  <td className="px-3 py-3 text-slate-950">
                    <div className="flex min-w-[520px] flex-wrap items-center gap-x-3 gap-y-1">
                      <strong className="font-mono font-black">{row.barcode}</strong>
                      {!base ? (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-black text-amber-800">
                          추가 후보
                        </span>
                      ) : null}
                      <span className="text-xs text-slate-600">
                        모델번호 <strong className="text-slate-900">{metadata?.modelNo || "-"}</strong>
                      </span>
                      <span className="text-xs text-slate-600">
                        모델명 <strong className="text-slate-900">{metadata?.modelName || "-"}</strong>
                      </span>
                      <span className="text-xs text-slate-600">
                        옵션명 <strong className="text-slate-900">{metadata?.saleOption || "-"}</strong>
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-semibold text-slate-700">
                    {base ? `${base.quantity.toLocaleString("ko-KR")}개` : "없음"}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">
                    <div className="flex flex-wrap gap-1.5">
                      {row.sources.map((source) => (
                        <span
                          key={source.draftId}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1"
                        >
                          {shortDraft(source.draftId)} · {source.quantity.toLocaleString("ko-KR")}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <input
                      type="number"
                      min={1}
                      max={MAX_QUANTITY}
                      step={1}
                      disabled={!entry.selected}
                      value={entry.quantity || ""}
                      onChange={(event) =>
                        updateEntry(row.barcode, {
                          quantity: Math.min(
                            MAX_QUANTITY,
                            Math.max(0, Math.round(Number(event.target.value) || 0)),
                          ),
                        })
                      }
                      className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-right font-bold disabled:bg-slate-100"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm">
        <strong className="text-slate-950">
          최종 선택 · {selectedRows.length} SKU · {selectedUnits.toLocaleString("ko-KR")}개
        </strong>
        <span className="text-xs text-slate-500">
          기존 Draft는 삭제하지 않고 CANCELLED 이력으로 보존합니다. 실제 1688 주문·결제 없음.
        </span>
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-bold text-amber-950">
          {notice}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">{value}</strong>
    </div>
  );
}
