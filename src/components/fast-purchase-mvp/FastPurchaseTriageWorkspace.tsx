"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  FastPurchaseMvpAction,
  FastPurchaseMvpRow,
} from "@/lib/fastPurchaseMvp";

type StockSense = "UNKNOWN" | "ENOUGH" | "LOW" | "OUT";
type ViewFilter = "ALL" | "ORDER" | "MANUAL" | "PENDING" | "PLANNED";

type TriageEntry = {
  stockSense: StockSense;
  plannedQuantity: number;
  note: string;
};

type TriageState = Record<string, TriageEntry>;
type PersistedTriage = {
  sourceFingerprint: string;
  entries: TriageState;
};
type StoredTriageResult = {
  entries: TriageState;
  stale: boolean;
};

const STORAGE_KEY = "commerceOs.fastPurchaseMvp.triage.v1";
const number = new Intl.NumberFormat("ko-KR");
const EMPTY_ENTRY: TriageEntry = {
  stockSense: "UNKNOWN",
  plannedQuantity: 0,
  note: "",
};

function isSystemOrder(action: FastPurchaseMvpAction) {
  return action === "ORDER_REVIEW" || action === "FALLBACK_ORDER_REVIEW";
}

function isManual(action: FastPurchaseMvpAction) {
  return action === "MANUAL_REVIEW" || action === "DEMAND_ONLY_REVIEW";
}

function tone(action: FastPurchaseMvpAction) {
  if (action === "ORDER_REVIEW") return "border-blue-200 bg-blue-50 text-blue-900";
  if (action === "FALLBACK_ORDER_REVIEW") return "border-violet-200 bg-violet-50 text-violet-900";
  if (action === "MANUAL_REVIEW") return "border-amber-200 bg-amber-50 text-amber-900";
  if (action === "DEMAND_ONLY_REVIEW") return "border-orange-200 bg-orange-50 text-orange-900";
  if (action === "HOLD") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (action === "FALLBACK_HOLD") return "border-teal-200 bg-teal-50 text-teal-900";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function stockLabel(value: StockSense) {
  if (value === "ENOUGH") return "재고 충분";
  if (value === "LOW") return "재고 부족";
  if (value === "OUT") return "품절로 판단";
  return "미판단";
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function clampManualQuantity(row: FastPurchaseMvpRow, value: unknown) {
  const planned = quantity(value);
  if (row.action === "DEMAND_ONLY_REVIEW") {
    return Math.min(planned, quantity(row.referenceDemandQuantity));
  }
  return planned;
}

function effectivePlannedQuantity(row: FastPurchaseMvpRow, entry: TriageEntry) {
  if (isSystemOrder(row.action)) return quantity(row.recommendedQuantity);
  if (isManual(row.action)) return clampManualQuantity(row, entry.plannedQuantity);
  return 0;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(rows: string[][]) {
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `commerce-os-fast-purchase-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function normalizeEntries(raw: unknown): TriageState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: TriageState = {};
  for (const [barcode, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const stockSense = String(row.stockSense ?? "UNKNOWN") as StockSense;
    if (!["UNKNOWN", "ENOUGH", "LOW", "OUT"].includes(stockSense)) continue;
    result[barcode] = {
      stockSense,
      plannedQuantity: quantity(row.plannedQuantity),
      note: String(row.note ?? "").slice(0, 300),
    };
  }
  return result;
}

function readStoredState(expectedFingerprint: string): StoredTriageResult {
  if (typeof window === "undefined") return { entries: {}, stale: false };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { entries: {}, stale: false };
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedTriage>;
    if (
      typeof parsed.sourceFingerprint !== "string" ||
      parsed.sourceFingerprint !== expectedFingerprint
    ) {
      return { entries: {}, stale: true };
    }
    return { entries: normalizeEntries(parsed.entries), stale: false };
  } catch {
    return { entries: {}, stale: true };
  }
}

export function FastPurchaseTriageWorkspace({
  rows,
  sourceFingerprint,
}: {
  rows: FastPurchaseMvpRow[];
  sourceFingerprint: string;
}) {
  const [triage, setTriage] = useState<TriageState>({});
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ViewFilter>("ALL");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = readStoredState(sourceFingerprint);
      setTriage(stored.entries);
      if (stored.stale) {
        setNotice(
          "발주 기준 데이터가 변경되어 이전 브라우저 판단·주문 예정수량을 초기화했습니다. 현재 표를 기준으로 다시 판단하세요.",
        );
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sourceFingerprint]);

  useEffect(() => {
    if (!hydrated) return;
    const persisted: PersistedTriage = {
      sourceFingerprint,
      entries: triage,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }, [hydrated, sourceFingerprint, triage]);

  const updateEntry = (
    barcode: string,
    patch: Partial<TriageEntry>,
    sourceRow?: FastPurchaseMvpRow,
  ) => {
    setTriage((current) => {
      const next = {
        ...(current[barcode] ?? EMPTY_ENTRY),
        ...patch,
      };
      if (sourceRow && patch.plannedQuantity !== undefined) {
        next.plannedQuantity = clampManualQuantity(
          sourceRow,
          patch.plannedQuantity,
        );
      }
      return { ...current, [barcode]: next };
    });
  };

  const summary = useMemo(() => {
    let manualReviewed = 0;
    let manualPending = 0;
    let plannedRows = 0;
    let plannedUnits = 0;
    for (const row of rows) {
      const entry = triage[row.barcode] ?? EMPTY_ENTRY;
      if (isManual(row.action)) {
        if (entry.stockSense === "UNKNOWN") manualPending += 1;
        else manualReviewed += 1;
      }
      const planned = effectivePlannedQuantity(row, entry);
      if (planned > 0) {
        plannedRows += 1;
        plannedUnits += planned;
      }
    }
    return { manualReviewed, manualPending, plannedRows, plannedUnits };
  }, [rows, triage]);

  const visibleRows = useMemo(() => {
    const needle = query.normalize("NFKC").trim().toLowerCase();
    return rows.filter((row) => {
      const entry = triage[row.barcode] ?? EMPTY_ENTRY;
      if (
        needle &&
        ![row.barcode, row.modelNo ?? "", row.productName]
          .join(" ")
          .normalize("NFKC")
          .toLowerCase()
          .includes(needle)
      ) {
        return false;
      }
      const planned = effectivePlannedQuantity(row, entry);
      if (filter === "ORDER") return planned > 0;
      if (filter === "MANUAL") return isManual(row.action);
      if (filter === "PENDING") {
        return isManual(row.action) && entry.stockSense === "UNKNOWN";
      }
      if (filter === "PLANNED") return planned > 0;
      return true;
    });
  }, [filter, query, rows, triage]);

  const exportPlan = () => {
    const planRows = rows.flatMap((row): string[][] => {
      const entry = triage[row.barcode] ?? EMPTY_ENTRY;
      const plannedQuantity = effectivePlannedQuantity(row, entry);
      if (plannedQuantity <= 0) return [];
      return [[
        row.barcode,
        row.modelNo ?? "",
        row.productName,
        row.actionLabel,
        row.basis,
        row.riskBias,
        stockLabel(entry.stockSense),
        String(row.referenceDemandQuantity),
        String(plannedQuantity),
        entry.note,
      ]];
    });
    if (!planRows.length) {
      setNotice(
        "내보낼 수량이 없습니다. 수동검토 상품은 판단 후 주문 예정수량을 직접 입력하세요.",
      );
      return;
    }
    downloadCsv([
      [
        "B-code",
        "모델번호",
        "상품명",
        "시스템판정",
        "근거",
        "위험편향",
        "재고판단",
        "재고0_수요참고",
        "주문예정수량",
        "메모",
      ],
      ...planRows,
    ]);
    setNotice(
      `주문예정 ${planRows.length}개 상품 CSV를 다운로드했습니다. 이 파일은 중국 주문을 자동 실행하지 않습니다.`,
    );
  };

  const clearTriage = () => {
    if (
      !window.confirm(
        "이 브라우저에 저장한 빠른 발주 판단·수량·메모를 모두 지울까요? 서버 데이터는 변경되지 않습니다.",
      )
    ) {
      return;
    }
    setTriage({});
    setNotice(
      "브라우저의 빠른 발주 판단을 초기화했습니다. 서버·재고·발주 데이터는 변경되지 않았습니다.",
    );
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-950">
            오늘 발주 검토 작업대
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-500">
            수동검토 상품은 창고를 전수조사하지 말고 기억·현장 체감으로
            `충분 / 부족 / 품절`만 빠르게 표시하세요. 주문 예정수량은 직접
            확정합니다. 판단과 메모는 이 브라우저에만 저장되며 Commerce OS
            서버, Product Master, 중국 주문에는 쓰지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportPlan}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
          >
            주문예정 CSV
          </button>
          <button
            type="button"
            onClick={clearTriage}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            브라우저 판단 초기화
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniMetric
          label="수동 판단 완료"
          value={number.format(summary.manualReviewed)}
        />
        <MiniMetric
          label="수동 판단 남음"
          value={number.format(summary.manualPending)}
        />
        <MiniMetric
          label="주문예정 상품"
          value={number.format(summary.plannedRows)}
        />
        <MiniMetric
          label="주문예정 총수량"
          value={number.format(summary.plannedUnits)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="B-code · 모델번호 · 상품명 검색"
          className="min-w-[260px] flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        {([
          ["ALL", "전체"],
          ["MANUAL", "수동판단"],
          ["PENDING", "미판단"],
          ["ORDER", "주문후보"],
          ["PLANNED", "수량확정"],
        ] as Array<[ViewFilter, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-xl border px-3 py-2 text-sm font-bold ${
              filter === value
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-slate-300 bg-white text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {notice ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {notice}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-[1900px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
            <tr>
              <th className="px-3 py-3">판정</th>
              <th className="px-3 py-3">B-code</th>
              <th className="px-3 py-3">모델번호</th>
              <th className="px-3 py-3">상품</th>
              <th className="px-3 py-3 text-right">시스템 주문검토</th>
              <th className="px-3 py-3 text-right">재고0 수요참고</th>
              <th className="px-3 py-3">빠른 재고판단</th>
              <th className="px-3 py-3 text-right">주문 예정수량</th>
              <th className="px-3 py-3">메모</th>
              <th className="px-3 py-3">근거</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.length ? (
              visibleRows.map((row) => {
                const entry = triage[row.barcode] ?? EMPTY_ENTRY;
                const manual = isManual(row.action);
                const systemOrderQuantity = isSystemOrder(row.action)
                  ? row.recommendedQuantity
                  : 0;
                const manualMax =
                  row.action === "DEMAND_ONLY_REVIEW"
                    ? quantity(row.referenceDemandQuantity)
                    : undefined;
                return (
                  <tr key={row.barcode} className="align-top">
                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${tone(row.action)}`}
                      >
                        {row.actionLabel}
                      </span>
                    </td>
                    <td className="px-3 py-4 font-mono font-black text-slate-950">
                      {row.barcode}
                    </td>
                    <td className="px-3 py-4 font-mono text-xs text-slate-600">
                      {row.modelNo ?? "-"}
                    </td>
                    <td className="max-w-[340px] px-3 py-4 font-bold text-slate-900">
                      {row.productName}
                    </td>
                    <td className="px-3 py-4 text-right text-lg font-black text-blue-700">
                      {number.format(systemOrderQuantity)}
                    </td>
                    <td className="px-3 py-4 text-right font-black text-orange-700">
                      {number.format(row.referenceDemandQuantity)}
                    </td>
                    <td className="px-3 py-4">
                      {manual ? (
                        <div className="flex min-w-[300px] flex-wrap gap-1.5">
                          {([
                            ["ENOUGH", "충분"],
                            ["LOW", "부족"],
                            ["OUT", "품절"],
                            ["UNKNOWN", "모름"],
                          ] as Array<[StockSense, string]>).map(
                            ([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() =>
                                  updateEntry(row.barcode, {
                                    stockSense: value,
                                    ...(value === "ENOUGH" ||
                                    value === "UNKNOWN"
                                      ? { plannedQuantity: 0 }
                                      : {}),
                                  }, row)
                                }
                                className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold ${
                                  entry.stockSense === value
                                    ? "border-slate-950 bg-slate-950 text-white"
                                    : "border-slate-300 bg-white text-slate-700"
                                }`}
                              >
                                {label}
                              </button>
                            ),
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">
                          시스템판정
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4 text-right">
                      {isSystemOrder(row.action) ? (
                        <strong className="text-lg text-blue-700">
                          {number.format(row.recommendedQuantity)}
                        </strong>
                      ) : manual ? (
                        <div className="flex min-w-[190px] items-center justify-end gap-2">
                          <input
                            type="number"
                            min={0}
                            max={manualMax}
                            step={1}
                            value={effectivePlannedQuantity(row, entry) || ""}
                            onChange={(event) =>
                              updateEntry(
                                row.barcode,
                                {
                                  plannedQuantity: event.target.value,
                                } as unknown as Partial<TriageEntry>,
                                row,
                              )
                            }
                            placeholder="직접 입력"
                            className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right font-black outline-none focus:border-slate-500"
                          />
                          {(entry.stockSense === "LOW" ||
                            entry.stockSense === "OUT") &&
                          row.referenceDemandQuantity > 0 ? (
                            <button
                              type="button"
                              onClick={() =>
                                updateEntry(
                                  row.barcode,
                                  {
                                    plannedQuantity:
                                      row.referenceDemandQuantity,
                                  },
                                  row,
                                )
                              }
                              className="rounded-lg border border-orange-300 bg-orange-50 px-2 py-1.5 text-[11px] font-bold text-orange-900"
                              title="재고 0 가정 참고상한을 주문 예정수량 입력칸에 복사합니다. 실제 주문은 실행하지 않습니다."
                            >
                              참고상한 넣기
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      {manual ? (
                        <input
                          value={entry.note}
                          onChange={(event) =>
                            updateEntry(row.barcode, {
                              note: event.target.value.slice(0, 300),
                            })
                          }
                          placeholder="예: 창고에 1박스 정도"
                          className="w-64 rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-slate-500"
                        />
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                    <td className="max-w-[420px] px-3 py-4 text-xs leading-5 text-slate-500">
                      <span className="font-mono font-black text-slate-700">
                        {row.basis}
                      </span>
                      <br />
                      {row.reason}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-10 text-center text-slate-500"
                >
                  조건에 맞는 상품이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
        `참고상한 넣기`는 수량 입력을 돕는 버튼일 뿐 주문 실행이 아닙니다.
        `수요만 수동검토` 행은 주문 예정수량을 재고0 참고상한보다 크게 저장하거나
        내보낼 수 없습니다. 발주 기준 fingerprint가 바뀌면 이전 브라우저 계획은
        자동 초기화되어 재확인을 요구합니다.
      </div>
      <p className="break-all text-[11px] text-slate-400">
        Source fingerprint · {sourceFingerprint}
      </p>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">{value}</strong>
    </article>
  );
}
