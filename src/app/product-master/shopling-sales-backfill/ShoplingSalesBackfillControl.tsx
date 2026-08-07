"use client";

import { useEffect, useState } from "react";
import type { ProductMasterShoplingSalesStatus } from "@/lib/productMasterShoplingSalesBackfill";

const number = new Intl.NumberFormat("ko-KR");

export function ShoplingSalesBackfillControl({
  initialStatus,
}: {
  initialStatus: ProductMasterShoplingSalesStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/product-master/shopling-sales-backfill", {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: ProductMasterShoplingSalesStatus;
      message?: string;
    };
    if (!response.ok || !payload.ok || !payload.status) {
      throw new Error(payload.message || "판매원장 상태를 불러오지 못했습니다.");
    }
    setStatus(payload.status);
  }

  async function act(action: "start" | "canary" | "full") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/product-master/shopling-sales-backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        result?: { message?: string };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "판매원장 작업에 실패했습니다.");
      }
      setMessage(payload.result?.message || payload.message || "작업을 완료했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "판매원장 작업 실패");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (status.state !== "QUEUED" && status.state !== "RUNNING") return;
    const timer = window.setInterval(() => {
      refresh().catch((error) => {
        setMessage(error instanceof Error ? error.message : "상태 갱신 실패");
      });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [status.state]);

  const report = status.report;
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              24 MONTH SALES LEDGER · GUARDED IMPORT
            </p>
            <h2 className="mt-2 text-xl font-black text-slate-950">
              Shopling 최근 24개월 판매원장
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Shopling 주문을 읽어 현재 상품마스터의 goods_key·옵션 ID·세트수량으로 위치코드별 실제 판매수량을 계산합니다. 수집 중에는 읽기 전용이며, 전수 연결 검증 후 1건 카나리와 전수 검증을 거쳐 상품마스터 월 판매원장만 저장합니다.
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">
            {status.state}
          </span>
        </div>

        <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${status.progress}%` }}
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="기간 구간" value={`${number.format(status.completedRanges)} / ${number.format(status.totalRanges)}`} />
          <Metric label="Shopling 조회행" value={number.format(status.fetchedRows)} />
          <Metric label="연결된 유효 주문" value={number.format(status.acceptedRows)} />
          <Metric label="월 판매원장 후보" value={number.format(status.monthlyRowCount)} />
          <Metric label="미연결 주문" value={number.format(status.unmappedRows)} danger={status.unmappedRows > 0} />
        </div>
        <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
          {status.stage} · {status.message}
        </p>
        {message ? (
          <p className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-900">
            {message}
          </p>
        ) : null}
      </section>

      {report ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="기본수량 환산 판매" value={number.format(report.totalBaseUnits)} />
          <Metric label="판매매출 합계" value={`${number.format(report.totalRevenue)}원`} />
          <Metric label="판매 SKU" value={number.format(report.barcodeCount)} />
          <Metric label="월 범위" value={report.months.length ? `${report.months[0]} ~ ${report.months.at(-1)}` : "-"} />
          <Metric label="중복 응답 제외" value={number.format(report.duplicateRows)} />
        </section>
      ) : null}

      {status.state === "IDLE" ? (
        <ActionCard
          title="판매원장 수집 시작"
          description="최근 24개월 Shopling 주문을 읽기 전용으로 먼저 수집합니다. 이 단계에서는 상품마스터 값을 변경하지 않습니다."
          button="최근 24개월 수집 시작"
          disabled={busy || !status.configured}
          onClick={() => act("start")}
        />
      ) : null}

      {status.state === "READY_CANARY" ? (
        <ActionCard
          title="1건 카나리 적재"
          description={`안전 후보 ${number.format(status.pendingCount)}건 중 1건만 상품마스터 월 판매원장에 저장하고 동일 수량·매출·월을 다시 읽어 검증합니다.`}
          button="판매원장 1건 카나리 적재 및 재검증"
          disabled={busy}
          onClick={() => act("canary")}
        />
      ) : null}

      {status.state === "READY_FULL" ? (
        <ActionCard
          title="카나리 검증 통과"
          description={`이미 검증된 ${number.format(status.alreadyAppliedCount)}건을 제외하고 남은 ${number.format(status.pendingCount)}건을 최대 500건씩 멱등 적재한 뒤 전수 재검증합니다.`}
          button={`남은 ${number.format(status.pendingCount)}건 안전 적재`}
          disabled={busy}
          onClick={() => act("full")}
        />
      ) : null}

      {status.state === "COMPLETED" ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm">
          <h2 className="text-lg font-black">판매원장 적재 완료</h2>
          <p className="mt-2 text-sm leading-6">
            상품마스터 월 판매원장 {number.format(status.alreadyAppliedCount)}건을 저장하고 재검증했습니다. 같은 기간을 다시 실행해도 동일 ID를 갱신하므로 중복 누적하지 않습니다.
          </p>
        </section>
      ) : null}

      {status.state === "BLOCKED" ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
          <h2 className="text-lg font-black text-rose-950">자동 적재 차단</h2>
          <p className="mt-2 text-sm leading-6 text-rose-900">{status.message}</p>
          {status.blockers.length ? (
            <div className="mt-4 overflow-x-auto rounded-xl border border-rose-200 bg-white">
              <table className="min-w-[900px] text-left text-sm">
                <thead className="border-b border-rose-100 text-xs font-bold text-slate-500">
                  <tr><th className="px-3 py-3">사유</th><th className="px-3 py-3">위치코드</th><th className="px-3 py-3">월</th><th className="px-3 py-3">설명</th></tr>
                </thead>
                <tbody className="divide-y divide-rose-50">
                  {status.blockers.slice(0, 100).map((blocker, index) => (
                    <tr key={`${blocker.code}:${blocker.barcode}:${blocker.month}:${index}`}>
                      <td className="px-3 py-3 font-mono text-xs">{blocker.code}</td>
                      <td className="px-3 py-3 font-mono text-xs">{blocker.barcode}</td>
                      <td className="px-3 py-3 text-xs">{blocker.month}</td>
                      <td className="px-3 py-3 text-xs">{blocker.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {report?.unmappedSamples?.length ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-white p-4 text-xs text-slate-700">
              <strong className="block text-sm text-slate-950">미연결 주문 표본</strong>
              {report.unmappedSamples.slice(0, 20).map((sample, index) => (
                <p key={index} className="mt-2 break-words">
                  {String(sample.orderNo ?? "-")} · {String(sample.optionId ?? "-")} · {String(sample.productId ?? "-")} · {String(sample.managedCode ?? "-")}
                </p>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {status.error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">
          {status.error}
        </p>
      ) : null}
    </div>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <article className={`rounded-xl border p-4 ${danger ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className={`mt-1 block text-xl ${danger ? "text-rose-800" : "text-slate-950"}`}>{value}</strong>
    </article>
  );
}

function ActionCard({ title, description, button, disabled, onClick }: {
  title: string;
  description: string;
  button: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">{title}</h2>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">{description}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="mt-5 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {button}
      </button>
    </section>
  );
}
