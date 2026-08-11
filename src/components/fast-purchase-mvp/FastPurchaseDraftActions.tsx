"use client";

import { useEffect, useMemo, useState } from "react";
import type { FastPurchaseMvpDataMode } from "@/lib/fastPurchaseMvpResilient";
import type { FastPurchaseMvpRow } from "@/lib/fastPurchaseMvp";

const STORAGE_KEY = "commerceOs.fastPurchaseMvp.triage.v1";
const MANUAL_QUANTITY_MAX = 9_999;

type StockSense = "UNKNOWN" | "ENOUGH" | "LOW" | "OUT";
type StoredEntry = { stockSense?: StockSense; plannedQuantity?: number; note?: string };
type StoredState = { sourceFingerprint?: string; entries?: Record<string, StoredEntry> };
type DraftSummary = {
  draftId: string;
  lineCount: number;
  requestedQuantity: number;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  updatedAt: string;
};
type HandoffResult = {
  draftId: string;
  lineCount: number;
  queuedQuantity: number;
  queueStatus: "PENDING" | "IMPORTED";
  alreadyQueued: boolean;
  alreadyImported: boolean;
  batchId: number | null;
  orderManagerUrl: string;
  externalOrderExecuted: false;
};

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function isManual(row: FastPurchaseMvpRow) {
  return row.action === "MANUAL_REVIEW" || row.action === "DEMAND_ONLY_REVIEW";
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
  const [handoffBusy, setHandoffBusy] = useState("");
  const [handoff, setHandoff] = useState<HandoffResult | null>(null);

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

  const saveDraft = async () => {
    setNotice("");
    setHandoff(null);
    let stored: StoredState;
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as StoredState;
    } catch {
      setNotice("브라우저의 빠른 발주 판단을 읽지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.");
      return;
    }
    if (stored.sourceFingerprint !== sourceFingerprint) {
      setNotice("발주 기준 데이터가 변경되었습니다. 페이지를 새로고침한 뒤 현재 기준으로 다시 확인하세요.");
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
      return [{
        barcode,
        plannedQuantity,
        stockSense: entry.stockSense,
        referenceDemandQuantity: integer(row.referenceDemandQuantity),
        note: String(entry.note ?? "").slice(0, 300),
      }];
    });
    if (!lines.length) {
      setNotice("저장할 주문 예정수량이 없습니다. 부족/품절 상품에 주문 예정수량을 입력하세요.");
      return;
    }

    const totalQuantity = lines.reduce((sum, line) => sum + line.plannedQuantity, 0);
    if (!window.confirm(`내부 발주 Draft ${lines.length}개 SKU · 총 ${totalQuantity}개를 저장할까요? 실제 중국 주문·결제는 실행하지 않습니다.`)) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/fast-purchase/drafts", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sourceFingerprint, dataMode, lines }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        code?: string;
        draft?: { draftId?: string; lineCount?: number; totalQuantity?: number; duplicate?: boolean };
      };
      if (!response.ok || !payload.ok) {
        setNotice(payload.message || `내부 Draft 저장 실패 · ${payload.code || response.status}`);
        return;
      }
      setNotice(
        `${payload.draft?.duplicate ? "기존 Draft 확인" : "내부 Draft 저장완료"} · ${payload.draft?.lineCount ?? lines.length}개 SKU · ${payload.draft?.totalQuantity ?? totalQuantity}개 · 실제 중국 주문 0`,
      );
      await refreshDrafts();
    } catch {
      setNotice("내부 Draft 저장 요청이 일시적으로 실패했습니다. 실제 중국 주문은 실행되지 않았습니다.");
    } finally {
      setSaving(false);
    }
  };

  const queueForChina = async (draft: DraftSummary) => {
    setNotice("");
    setHandoff(null);
    if (
      !window.confirm(
        `${draft.lineCount}개 SKU · 미입고 ${draft.openQuantity}개를 중국 발주·입고 관리의 주문초안으로 전달할까요? 아직 1688 주문·결제는 실행하지 않습니다.`,
      )
    ) {
      return;
    }
    setHandoffBusy(draft.draftId);
    try {
      const response = await fetch("/api/fast-purchase/drafts/queue", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ draftId: draft.draftId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        code?: string;
        handoff?: HandoffResult;
      };
      if (!response.ok || !payload.ok || !payload.handoff) {
        setNotice(payload.message || `중국 주문초안 전달 실패 · ${payload.code || response.status}`);
        return;
      }
      setHandoff(payload.handoff);
      setNotice(
        `${payload.handoff.alreadyImported ? "중국 주문초안 이미 반영" : payload.handoff.alreadyQueued ? "중국 주문초안 전달 대기 중" : "중국 주문초안 전달 준비완료"} · ${payload.handoff.lineCount}개 SKU · ${payload.handoff.queuedQuantity}개 · 실제 1688 주문 0`,
      );
    } catch {
      setNotice("중국 주문초안 전달 요청이 일시적으로 실패했습니다. 실제 1688 주문은 실행되지 않았습니다.");
    } finally {
      setHandoffBusy("");
    }
  };

  const activeDrafts = drafts.filter((draft) => draft.openQuantity > 0);
  const activeUnits = activeDrafts.reduce((sum, draft) => sum + draft.openQuantity, 0);

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-blue-700">INTERNAL PURCHASE DRAFT · NO EXTERNAL ORDER</span>
          <h2 className="mt-1 text-xl font-black text-slate-950">검토 완료 수량을 내부 발주 Draft로 고정</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            부족/품절로 판단하고 주문 예정수량을 입력한 행만 Ops Center 불변 원장에 `RESERVED`로 저장합니다. 저장된 수량은 다음 발주안에서 미입고 약정으로 차감되어 중복발주를 막습니다. 이후 중국 주문초안으로 전달해도 실제 1688 주문·결제는 별도 확인 전까지 실행되지 않습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={saveDraft}
          disabled={saving}
          className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "내부 Draft 저장 중..." : "내부 발주 Draft 저장"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="활성 내부 Draft" value={`${activeDrafts.length}건`} />
        <Metric label="현재 미입고 약정" value={`${activeUnits.toLocaleString("ko-KR")}개`} />
        <Metric label="외부 중국 주문" value="0건" />
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-blue-300 bg-white px-4 py-3 text-sm font-bold text-blue-950">
          {notice}
        </div>
      ) : null}

      {handoff ? (
        <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <strong className="text-sm text-emerald-950">중국 주문초안 전달 준비가 끝났습니다.</strong>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            중국 발주·입고 관리에서 공급처 링크·중국 옵션·위안단가·운임을 확인한 뒤 실제 주문을 진행하세요. 아직 1688 주문·결제는 실행되지 않았습니다.
          </p>
          <a
            href={handoff.orderManagerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800"
          >
            중국 주문초안 열기
          </a>
        </div>
      ) : null}

      {activeDrafts.length ? (
        <div className="mt-4 space-y-2 text-xs text-slate-600">
          {activeDrafts.slice(0, 5).map((draft) => (
            <div key={draft.draftId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2">
              <div>
                <span className="font-mono">{draft.draftId}</span>
                <span className="ml-3">{draft.lineCount} SKU · 미입고 {draft.openQuantity.toLocaleString("ko-KR")}개 · {new Date(draft.updatedAt).toLocaleString("ko-KR")}</span>
              </div>
              <button
                type="button"
                onClick={() => void queueForChina(draft)}
                disabled={handoffBusy === draft.draftId}
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-50"
              >
                {handoffBusy === draft.draftId ? "전달 중..." : "중국 주문초안 전달"}
              </button>
            </div>
          ))}
        </div>
      ) : null}
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
