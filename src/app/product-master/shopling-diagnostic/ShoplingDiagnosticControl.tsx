"use client";

import { useEffect, useState } from "react";
import type {
  ProductMasterShoplingDiagnosticStatus,
} from "@/lib/productMasterShoplingDiagnostic";

const number = new Intl.NumberFormat("ko-KR");

export function ShoplingDiagnosticControl({
  initialStatus,
}: {
  initialStatus: ProductMasterShoplingDiagnosticStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/product-master/shopling-diagnostic", {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: ProductMasterShoplingDiagnosticStatus;
      message?: string;
    };
    if (!response.ok || !payload.ok || !payload.status) {
      throw new Error(payload.message || "전수진단 상태를 불러오지 못했습니다.");
    }
    setStatus(payload.status);
  }

  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/product-master/shopling-diagnostic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "전수진단을 시작하지 못했습니다.");
      }
      setMessage(payload.message || "전수진단을 접수했습니다.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "전수진단 시작 실패");
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

  const running = status.state === "QUEUED" || status.state === "RUNNING";
  const report = status.report;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              READ ONLY · FULL CATALOG DIAGNOSTIC
            </p>
            <h2 className="mt-2 text-xl font-black text-slate-950">
              위치코드·Shopling 옵션·세트수량 전수진단
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Shopling 상품과 옵션을 기간별로 읽어 상품마스터 바코드에 연결할 후보와 판매 1건당 실제 재고 환산수량을 계산합니다. 이 화면에서는 상품마스터와 Shopling 값을 변경하지 않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={start}
            disabled={!status.configured || running || busy}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy
              ? "접수 중..."
              : running
                ? "전수진단 진행 중"
                : status.state === "COMPLETED"
                  ? "최신 기준으로 다시 진단"
                  : "전수진단 시작"}
          </button>
        </div>

        {!status.configured ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
            Shopling 읽기 환경변수 또는 Product Master 연동 설정이 준비되지 않았습니다.
          </p>
        ) : null}
        {message ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {message}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-500">현재 상태</p>
            <strong className="mt-1 block text-lg text-slate-950">{status.stage}</strong>
            <p className="mt-1 text-sm text-slate-600">{status.message}</p>
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
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
          <StatusMetric label="진행률" value={`${status.progress}%`} />
          <StatusMetric
            label="기간 구간"
            value={`${number.format(status.completedRanges)} / ${number.format(status.totalRanges)}`}
          />
          <StatusMetric label="Shopling 조회행" value={number.format(status.fetchedRows)} />
          <StatusMetric label="위치코드 옵션" value={number.format(status.managedOptions)} />
        </div>
      </section>

      {status.error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-950">
          <strong className="block text-base">전수진단 실패</strong>
          <p className="mt-2 break-words leading-6">{status.error}</p>
        </section>
      ) : null}

      {report ? <DiagnosticReportView report={report} /> : null}
    </div>
  );
}

function DiagnosticReportView({
  report,
}: {
  report: NonNullable<ProductMasterShoplingDiagnosticStatus["report"]>;
}) {
  const summary = report.summary;
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <ReportMetric label="상품마스터 SKU" value={summary.planningSkuCount} />
        <ReportMetric label="위치코드 일치 SKU" value={summary.matchedSkuCount} />
        <ReportMetric label="정확한 기존 연결" value={summary.exactListingMatchCount} />
        <ReportMetric
          label="새 연결 후보"
          value={summary.missingListingCandidateCount}
          warning={summary.missingListingCandidateCount > 0}
        />
        <ReportMetric
          label="원인 차단"
          value={summary.blockerCount}
          danger={summary.blockerCount > 0}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <ReportMetric label="관리 위치코드 옵션" value={summary.managedShoplingOptionCount} />
        <ReportMetric label="미사용 일반 옵션" value={summary.ignoredUnmanagedOptionCount} />
        <ReportMetric label="오래된 연결" value={summary.staleListingCount} />
        <ReportMetric label="환산수량 차이" value={summary.unitsMismatchCount} />
        <ReportMetric label="상품마스터 밖 코드" value={summary.orphanManagedOptionCount} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">자동 연결 후보</h2>
            <p className="mt-1 text-sm text-slate-500">
              바코드가 정확히 일치한 후보입니다. 아직 상품마스터에는 저장하지 않았습니다.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            {number.format(report.candidates.length)}개
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1050px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
              <tr>
                <th className="px-3 py-3">위치코드</th>
                <th className="px-3 py-3">모델번호</th>
                <th className="px-3 py-3">goods_key</th>
                <th className="px-3 py-3">옵션 ID</th>
                <th className="px-3 py-3">Shopling 상품·옵션</th>
                <th className="px-3 py-3">권장 환산수량</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.candidates.slice(0, 500).map((candidate) => (
                <tr key={`${candidate.skuId}:${candidate.goodsKey}:${candidate.optionId}`}>
                  <td className="px-3 py-4 font-mono text-xs">{candidate.barcode}</td>
                  <td className="px-3 py-4 text-xs">{candidate.modelNo || "-"}</td>
                  <td className="px-3 py-4 font-mono text-xs">{candidate.goodsKey}</td>
                  <td className="px-3 py-4 font-mono text-xs">{candidate.optionId || "-"}</td>
                  <td className="px-3 py-4">
                    <strong className="block text-slate-950">{candidate.productName || "상품명 없음"}</strong>
                    <span className="mt-1 block text-xs text-slate-500">{candidate.optionName || "단품"}</span>
                  </td>
                  <td className="px-3 py-4 font-black text-slate-950">
                    {candidate.expectedUnitsPerOrder ?? "수동 확인"}
                  </td>
                </tr>
              ))}
              {!report.candidates.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-emerald-700">
                    새로 연결할 후보가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {report.candidates.length > 500 ? (
          <p className="mt-3 text-xs text-slate-500">
            전체 후보 중 500개만 화면에 표시합니다.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">전수진단 문제</h2>
            <p className="mt-1 text-sm text-slate-500">
              차단 문제를 먼저 해결한 뒤 검토 항목을 연결 후보에 반영합니다.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            {number.format(report.issues.length)}개
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1100px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
              <tr>
                <th className="px-3 py-3">단계</th>
                <th className="px-3 py-3">위치코드</th>
                <th className="px-3 py-3">goods_key·옵션</th>
                <th className="px-3 py-3">상품</th>
                <th className="px-3 py-3">환산수량</th>
                <th className="px-3 py-3">진단</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.issues.slice(0, 500).map((issue, index) => (
                <tr key={`${issue.code}:${issue.skuId ?? ""}:${issue.goodsKey ?? ""}:${issue.optionId ?? ""}:${index}`}>
                  <td className="px-3 py-4">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${issue.severity === "BLOCKER" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                      {issue.severity === "BLOCKER" ? "차단" : "검토"}
                    </span>
                  </td>
                  <td className="px-3 py-4 font-mono text-xs">{issue.barcode || "-"}</td>
                  <td className="px-3 py-4 font-mono text-xs">
                    {issue.goodsKey || "-"} · {issue.optionId || "-"}
                  </td>
                  <td className="px-3 py-4">
                    <strong className="block text-slate-950">{issue.productName || "상품명 없음"}</strong>
                    <span className="mt-1 block text-xs text-slate-500">{issue.optionName || "단품"}</span>
                  </td>
                  <td className="px-3 py-4 text-xs">
                    현재 {issue.existingUnitsPerOrder ?? "-"} · 권장 {issue.expectedUnitsPerOrder ?? "-"}
                  </td>
                  <td className="px-3 py-4 text-xs leading-5 text-slate-600">{issue.message}</td>
                </tr>
              ))}
              {!report.issues.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-emerald-700">
                    전수진단 차단·검토 문제가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {report.issues.length > 500 ? (
          <p className="mt-3 text-xs text-slate-500">
            전체 문제 중 500개만 화면에 표시합니다.
          </p>
        ) : null}
      </section>
    </>
  );
}

function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl bg-slate-50 p-3">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-slate-950">{value}</strong>
    </article>
  );
}

function ReportMetric({
  label,
  value,
  danger = false,
  warning = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
  warning?: boolean;
}) {
  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-sm ${danger ? "border-rose-200" : warning ? "border-amber-200" : "border-slate-200"}`}>
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <strong className={`mt-2 block text-2xl font-black ${danger ? "text-rose-700" : warning ? "text-amber-700" : "text-slate-950"}`}>
        {number.format(value)}
      </strong>
    </article>
  );
}
