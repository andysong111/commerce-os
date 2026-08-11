"use client";

import { useEffect, useMemo, useState } from "react";
import type { FastPurchaseMvpDataMode } from "@/lib/fastPurchaseMvpResilient";
import type { FastPurchaseMvpRow } from "@/lib/fastPurchaseMvp";

const STORAGE_KEY = "commerceOs.fastPurchaseMvp.triage.v1";
const MANUAL_QUANTITY_MAX = 9_999;

type StockSense = "UNKNOWN" | "ENOUGH" | "LOW" | "OUT";
type StoredEntry = {
  stockSense?: StockSense;
  plannedQuantity?: number;
  note?: string;
};
type StoredState = {
  sourceFingerprint?: string;
  entries?: Record<string, StoredEntry>;
};
type DraftSummary = {
  draftId: string;
  cycleMonth: string;
  createdAt: string;
  lineCount: number;
  requestedQuantity: number;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  updatedAt: string;
};

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function isManual(row: FastPurchaseMvpRow) {
  return row.action === "MANUAL_REVIEW" || row.action === "DEMAND_ONLY_REVIEW";
}

function internalChinaDraftUrl(draftId: string) {
  return `/china-order-manager/drafts/${encodeURIComponent(draftId)}`;
}

function seoulCurrentMonth() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function monthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month || "이번 달";
  const [year, monthNumber] = month.split("-");
  return `${Number(year)}년 ${Number(monthNumber)}월`;
}

export function FastPurchaseDraftActions({
  rows,
  sourceFingerprint,
  dataMode,
}: {
  rows: FastPurchaseMvpRow[];
  sourceFingerprint: string;
  dataMode: FastPurchaseMvpDataMode;
}) {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const rowByBarcode = useMemo(
    () => new Map(rows.map((row) => [row.barcode, row] as const)),
    [rows],
  );

  const refreshDrafts = async () => {
    try {
      const response = await fetch("/api/fast-purchase/drafts", {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        drafts?: DraftSummary[];
      };
      if (response.ok && payload.ok && Array.isArray(payload.drafts)) {
        setDrafts(payload.drafts);
      }
    } catch {
      // The fast-purchase page itself stays usable even if this optional ledger panel cannot load.
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshDrafts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const currentCycleMonth = seoulCurrentMonth();
  const currentCycleDrafts = drafts.filter(
    (draft) => draft.cycleMonth === currentCycleMonth,
  );
  const monthlyLocked = currentCycleDrafts.length > 0;

  const saveDraft = async () => {
    setNotice("");
    if (monthlyLocked) {
      setNotice(
        `${monthLabel(currentCycleMonth)} 발주차시는 이미 생성했습니다. 발주 추천은 월 1회만 확정하며 같은 달에 새 내부 Draft를 만들지 않습니다.`,
      );
      return;
    }
    let stored: StoredState;
    try {
      stored = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? "{}",
      ) as StoredState;
    } catch {
      setNotice(
        "브라우저의 빠른 발주 판단을 읽지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.",
      );
      return;
    }
    if (stored.sourceFingerprint !== sourceFingerprint) {
      setNotice(
        "발주 기준 데이터가 변경되었습니다. 페이지를 새로고침한 뒤 현재 기준으로 다시 확인하세요.",
      );
      return;
    }
    const entries = stored.entries ?? {};
    const lines = Object.entries(entries).flatMap(([barcode, entry]) => {
      const row = rowByBarcode.get(barcode);
      if (!row || !isManual(row)) return [];
      if (entry.stockSense !== "LOW" && entry.stockSense !== "OUT") return [];
      const plannedQuantity = Math.min(
        integer(entry.plannedQuantity),
        MANUAL_QUANTITY_MAX,
      );
      if (plannedQuantity <= 0) return [];
      return [
        {
          barcode,
          plannedQuantity,
          stockSense: entry.stockSense,
          referenceDemandQuantity: integer(row.referenceDemandQuantity),
          note: String(entry.note ?? "").slice(0, 300),
        },
      ];
    });
    if (!lines.length) {
      setNotice(
        "저장할 주문 예정수량이 없습니다. 부족/품절 상품에 주문 예정수량을 입력하세요.",
      );
      return;
    }

    const totalQuantity = lines.reduce(
      (sum, line) => sum + line.plannedQuantity,
      0,
    );
    if (
      !window.confirm(
        `${monthLabel(currentCycleMonth)} 발주차시를 ${lines.length}개 SKU · 총 ${totalQuantity}개로 확정할까요?\n\n이 달에는 다른 발주 Draft를 새로 만들 수 없습니다. 실제 중국 주문·결제는 실행하지 않습니다.`,
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/fast-purchase/drafts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ sourceFingerprint, dataMode, lines }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        code?: string;
        draft?: {
          draftId?: string;
          lineCount?: number;
          totalQuantity?: number;
          duplicate?: boolean;
        };
      };
      if (!response.ok || !payload.ok) {
        const monthlyConflict =
          payload.code === "FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED" ||
          String(payload.message ?? "").includes(
            "FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED",
          );
        setNotice(
          monthlyConflict
            ? `${monthLabel(currentCycleMonth)} 발주차시가 이미 존재합니다. 기존 월간 Draft를 사용하세요.`
            : payload.message ||
                `내부 Draft 저장 실패 · ${payload.code || response.status}`,
        );
        await refreshDrafts();
        return;
      }
      setNotice(
        `${payload.draft?.duplicate ? "기존 월간 Draft 확인" : "월간 발주 Draft 저장완료"} · ${payload.draft?.lineCount ?? lines.length}개 SKU · ${payload.draft?.totalQuantity ?? totalQuantity}개 · 이제 같은 Draft를 Ops Center 내부 중국 발주초안에서 주문 준비에 사용합니다.`,
      );
      await refreshDrafts();
    } catch {
      setNotice(
        "내부 Draft 저장 요청이 일시적으로 실패했습니다. 실제 중국 주문은 실행되지 않았습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  const activeDrafts = drafts.filter((draft) => draft.openQuantity > 0);
  const activeUnits = activeDrafts.reduce(
    (sum, draft) => sum + draft.openQuantity,
    0,
  );
  const orderedUnits = activeDrafts.reduce(
    (sum, draft) => sum + draft.orderedQuantity,
    0,
  );

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-blue-700">
            MONTHLY PURCHASE DRAFT · OPS CENTER NATIVE
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">
            검토 완료 수량을 월간 발주 Draft로 고정
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            발주 추천은 달력월마다 한 번만 확정합니다. 부족/품절 수량을
            `RESERVED`로 저장하면 그 달의 발주차시가 잠기고, 당월 판매 데이터가
            추가되어도 새 발주 Draft를 다시 만들지 않습니다. 저장된 미입고 수량은
            다음 달 발주 계산에서 중복발주 방지용으로 차감됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={saveDraft}
          disabled={saving || monthlyLocked}
          className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:opacity-70"
        >
          {saving
            ? "월간 Draft 저장 중..."
            : monthlyLocked
              ? `${monthLabel(currentCycleMonth)} 발주차시 생성완료`
              : `${monthLabel(currentCycleMonth)} 발주 Draft 확정`}
        </button>
      </div>

      {monthlyLocked ? (
        <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          <strong>{monthLabel(currentCycleMonth)} 신규 발주 잠금</strong>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            이번 달에 생성된 내부 Draft가 {currentCycleDrafts.length}건 있습니다.
            과거 개발 과정에서 같은 달 Draft가 여러 건 생긴 경우는 기존 데이터로
            보존하지만, 지금부터는 추가 생성이 차단됩니다. 실제 주문하지 않을
            과거 Draft는 별도로 해제해 미입고 원장을 정리해야 합니다.
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="활성 내부 Draft" value={`${activeDrafts.length}건`} />
        <Metric
          label="현재 미입고 약정"
          value={`${activeUnits.toLocaleString("ko-KR")}개`}
        />
        <Metric
          label="실주문 기록 수량"
          value={`${orderedUnits.toLocaleString("ko-KR")}개`}
        />
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-blue-300 bg-white px-4 py-3 text-sm font-bold text-blue-950">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
        <strong className="text-sm text-emerald-950">
          중국 발주 준비는 같은 월간 Draft를 계속 사용합니다.
        </strong>
        <p className="mt-1 text-xs leading-5 text-emerald-800">
          아래 Draft를 열면 B-code·모델·옵션·1688 링크·수량을 이어받고,
          위안단가와 중국내 운임을 입력해 원가를 검증합니다. 월간 발주 잠금은
          상품등급·가격조정의 일일 판매이력 갱신에는 적용되지 않습니다.
        </p>
      </div>

      {activeDrafts.length ? (
        <div className="mt-4 space-y-2 text-xs text-slate-600">
          {activeDrafts.slice(0, 8).map((draft) => (
            <div
              key={draft.draftId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"
            >
              <div>
                <span className="font-mono">{draft.draftId}</span>
                <span className="ml-3">
                  {draft.cycleMonth ? `${monthLabel(draft.cycleMonth)} · ` : ""}
                  {draft.lineCount} SKU · 미입고{" "}
                  {draft.openQuantity.toLocaleString("ko-KR")}개 · 실주문 기록{" "}
                  {draft.orderedQuantity.toLocaleString("ko-KR")}개 ·{" "}
                  {new Date(draft.updatedAt).toLocaleString("ko-KR")}
                </span>
              </div>
              <a
                href={internalChinaDraftUrl(draft.draftId)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 font-black text-emerald-800 hover:bg-emerald-100"
              >
                Ops Center 중국 주문초안 열기
              </a>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          현재 열려 있는 내부 발주 Draft가 없습니다.
        </p>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-blue-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">{value}</strong>
    </div>
  );
}
