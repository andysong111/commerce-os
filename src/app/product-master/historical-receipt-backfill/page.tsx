"use client";

import Link from "next/link";
import { useState } from "react";
import type { HistoricalReceiptBackfillReport } from "@/lib/productMasterHistoricalReceiptBackfill";

const number = new Intl.NumberFormat("ko-KR");
const money = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

type ExportSnapshot = {
  format?: string;
  exportedAt?: string;
  fingerprint?: string;
  summary?: {
    maxBatchId?: number;
    discoveredBatches?: number;
    confirmedReceipts?: number;
    receiptItems?: number;
    managedBarcodeItems?: number;
    totalConfirmedQuantity?: number;
    skippedRows?: number;
  };
  events?: unknown[];
};

type DiagnoseResponse = {
  ok?: boolean;
  report?: HistoricalReceiptBackfillReport;
  message?: string;
  error?: string;
};

export default function HistoricalReceiptBackfillPage() {
  const [snapshot, setSnapshot] = useState<ExportSnapshot | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<HistoricalReceiptBackfillReport | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "구 중국 발주·입고 Site에서 읽기 전용 JSON을 먼저 추출하세요.",
  );
  const [failed, setFailed] = useState(false);

  async function chooseFile(file: File | null) {
    setReport(null);
    setSnapshot(null);
    setFileName(file?.name ?? "");
    setFailed(false);
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as ExportSnapshot;
      if (parsed.format !== "commerce-os-historical-confirmed-receipts-v1") {
        throw new Error(
          "Commerce OS 과거 확정입고 v1 추출 파일이 아닙니다.",
        );
      }
      if (!Array.isArray(parsed.events) || !parsed.events.length) {
        throw new Error("확정입고 이벤트가 없는 파일입니다.");
      }
      setSnapshot(parsed);
      setMessage(
        `파일 확인 완료 · 확정입고 ${number.format(parsed.summary?.confirmedReceipts ?? parsed.events.length)}건 · 서버 진단을 실행하세요.`,
      );
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "과거 확정입고 JSON을 읽지 못했습니다.",
      );
    }
  }

  async function diagnose() {
    if (!snapshot) return;
    setBusy(true);
    setFailed(false);
    setMessage("Product Master 현재 SKU·원장과 읽기 전용으로 대조하고 있습니다.");
    try {
      const response = await fetch(
        "/api/product-master/historical-receipt-backfill/diagnose",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ snapshot }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as DiagnoseResponse;
      if (!response.ok || !body.report) {
        throw new Error(
          body.message || body.error || "과거 확정입고 진단에 실패했습니다.",
        );
      }
      setReport(body.report);
      setMessage(
        body.report.blockers.length
          ? `진단 완료 · 자동 적재 차단 ${number.format(body.report.blockers.length)}건을 먼저 해결해야 합니다.`
          : `진단 완료 · 안전 신규 ${number.format(body.report.summary.safeNew)}건 · 안전 보완 ${number.format(body.report.summary.safeRepair)}건입니다.`,
      );
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "과거 확정입고 진단에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  const reviewRows = report?.candidates.filter(
    (row) => !["SAFE_NEW", "ALREADY_PRESENT"].includes(row.status),
  );

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-emerald-700">
              COMMERCE OS · PRODUCT MASTER · STAGE 7
            </p>
            <h1 className="mt-2 text-2xl font-black text-slate-950">
              과거 확정입고 연결 진단
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              구 중국 발주·입고 관리의 확정입고 JSON을 현재 Product Master 활성
              B-code SKU와 정확히 대조합니다. 이 화면은 진단만 수행하며 재고·원가를
              실제로 쓰지 않습니다.
            </p>
          </div>
          <Link
            href="/product-master/inventory-cost-readiness"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            재고·입고원가 신뢰도
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">1. 구 Site에서 JSON 추출</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          중국 발주 레포를 최신 main으로 받은 뒤 PowerShell에서
          <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            .\scripts\copy-historical-receipt-exporter.ps1
          </code>
          을 실행합니다. 구 Site를 열고 F12 → Console에 붙여넣으면 GET 요청만으로
          과거 확정입고 JSON 1개가 다운로드됩니다.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          원본 Site · china-order-manager.andy123df23.chatgpt.site · D1/Shopling/1688
          쓰기 없음
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">2. 추출 파일 선택</h2>
        <input
          className="mt-4 block w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
        />
        <div
          className={`mt-4 rounded-xl border p-4 text-sm ${
            failed
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          {message}
          {fileName ? <span className="ml-2 text-xs">({fileName})</span> : null}
        </div>

        {snapshot ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric
              label="발견 발주차시"
              value={snapshot.summary?.discoveredBatches ?? 0}
            />
            <Metric
              label="확정입고"
              value={snapshot.summary?.confirmedReceipts ?? snapshot.events?.length ?? 0}
            />
            <Metric label="입고행" value={snapshot.summary?.receiptItems ?? 0} />
            <Metric
              label="관리 B-code 행"
              value={snapshot.summary?.managedBarcodeItems ?? 0}
            />
            <Metric
              label="정상입고 수량"
              value={snapshot.summary?.totalConfirmedQuantity ?? 0}
            />
            <Metric label="추출 제외" value={snapshot.summary?.skippedRows ?? 0} />
          </div>
        ) : null}

        <button
          type="button"
          disabled={!snapshot || busy}
          onClick={() => void diagnose()}
          className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? "현재 Product Master와 대조 중…" : "읽기 전용 안전 진단 실행"}
        </button>
      </section>

      {report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="전체 입고행" value={report.summary.items} />
            <Metric label="안전 신규" value={report.summary.safeNew} good />
            <Metric label="안전 보완" value={report.summary.safeRepair} good />
            <Metric
              label="이미 반영"
              value={report.summary.alreadyPresent}
            />
            <Metric
              label="현재 SKU 없음"
              value={report.summary.currentSkuNotFound}
              warning
            />
            <Metric
              label="자동적재 차단"
              value={
                report.summary.duplicateActiveSku +
                report.summary.existingLedgerConflict
              }
              danger
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="PM 등록 전 안전행"
              value={report.summary.preProductMasterBaseline}
            />
            <Metric
              label="PM 등록 후 안전행"
              value={report.summary.postProductMasterBaseline}
            />
            <Metric label="안전 정상입고 수량" value={report.summary.safeQuantity} />
            <MoneyMetric
              label="안전 입고원가 가중합"
              value={report.summary.safeReceiptCostKrwWeighted}
            />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">검토·보완 대상</h2>
                <p className="mt-1 text-sm text-slate-500">
                  안전 신규와 이미 반영된 행을 제외해 표시합니다. 현재 SKU가 없는 과거
                  B-code는 임의로 새 SKU를 만들지 않습니다.
                </p>
              </div>
              <span className="text-xs text-slate-500">
                {number.format(reviewRows?.length ?? 0)}건
              </span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[980px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
                  <tr>
                    <th className="px-3 py-3">입고일</th>
                    <th className="px-3 py-3">위치코드</th>
                    <th className="px-3 py-3">수량</th>
                    <th className="px-3 py-3">확정원가</th>
                    <th className="px-3 py-3">분류</th>
                    <th className="px-3 py-3">이유</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reviewRows?.slice(0, 500).map((row) => (
                    <tr key={row.key}>
                      <td className="px-3 py-3 text-xs">
                        {new Date(row.occurredAt).toLocaleDateString("ko-KR")}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs font-bold">
                        {row.barcode}
                      </td>
                      <td className="px-3 py-3">{number.format(row.quantity)}</td>
                      <td className="px-3 py-3">
                        {money.format(row.unitCostKrw)}
                      </td>
                      <td className="px-3 py-3 text-xs font-bold">{row.status}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        {row.reason}
                      </td>
                    </tr>
                  ))}
                  {!reviewRows?.length ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-10 text-center text-emerald-700"
                      >
                        검토·보완 대상이 없습니다.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-1 break-all text-xs text-slate-400">
              <p>원본 지문 {report.sourceFingerprint}</p>
              <p>연결계획 지문 {report.planFingerprint}</p>
              <p>
                실제 적재는 이 화면에서 실행하지 않습니다. 진단 결과를 고정한 뒤 1건
                카나리 → 재진단 → 안전 전수적재 순서로 별도 실행합니다.
              </p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  good = false,
  warning = false,
  danger = false,
}: {
  label: string;
  value: number;
  good?: boolean;
  warning?: boolean;
  danger?: boolean;
}) {
  const tone = danger
    ? "border-rose-200 bg-rose-50"
    : warning
      ? "border-amber-200 bg-amber-50"
      : good
        ? "border-emerald-200 bg-emerald-50"
        : "border-slate-200 bg-white";
  return (
    <article className={`rounded-xl border p-4 ${tone}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">
        {number.format(value)}
      </strong>
    </article>
  );
}

function MoneyMetric({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-lg text-slate-950">
        {money.format(value)}
      </strong>
    </article>
  );
}
