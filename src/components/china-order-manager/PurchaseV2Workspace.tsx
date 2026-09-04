"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

export type PurchaseV2ClientRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  pattern: string;
  group: string;
  monthlyDemandForecast: number;
  targetDemand44Days: number;
  observedRecent30Units: number;
  adjustedRecent30Units: number;
  stockoutRecoveredUnits: number;
  priceChangeRate: number | null;
  exactInventoryKnown: boolean;
  inventoryLowQuantity: number | null;
  inventoryHighQuantity: number | null;
  openCommitment: number;
  preBudgetRecommendedQuantity: number;
  cashAllocatedQuantity: number;
  unitCostKrw: number;
  expectedAllocatedProductCostKrw: number;
  priorityScore: number;
  budgetReduced: boolean;
  reason: string;
};

export type PurchaseV2ClientReport = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  ruleVersion: string;
  cycleMonth: string;
  budgetMonth: string;
  maxGrossBudgetKrw: number;
  recorded1688SpendKrw: number;
  maxAdditionalGrossBudgetKrw: number;
  requestedCashKrw: number | null;
  effectiveCashKrw: number;
  cashClamped: boolean;
  purchaseCostMultiplier: number;
  productOrderBudgetKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  remainingCashKrw: number;
  evaluatedSkuCount: number;
  recommendedSkuCount: number;
  manualReviewSkuCount: number;
  budgetReducedSkuCount: number;
  patternCounts: Record<string, number>;
  groupCounts: Record<string, number>;
  rows: PurchaseV2ClientRow[];
  blockers: string[];
  fingerprint: string;
};

export type InventoryLifecycleClientRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  productMode: "OPTION" | "SINGLE";
  resetAt: string;
  exactInventoryKnown: boolean;
  exactInventoryQuantity: number | null;
  inboundAfterReset: number;
  salesAfterReset: number;
  latestSuccessfulShoplingStatus: "SOLD_OUT" | "SELLING" | null;
  latestShoplingSyncState: string | null;
  latestShoplingSyncStage: string | null;
  nextRecommendedSync: "SOLD_OUT" | "SELLING" | null;
  pendingJobId: string | null;
};

export type InventoryLifecycleClientSnapshot = {
  state: "READY" | "BLOCKED";
  message: string;
  rows: InventoryLifecycleClientRow[];
  blockers: string[];
};

type FinalizedSummary = {
  finalizedAt: string;
  cashKrw: number;
  reportFingerprint: string;
  report: PurchaseV2ClientReport;
} | null;

type ShoplingLifecycleJob = {
  jobId: string;
  barcode: string;
  modelNo: string | null;
  productName: string;
  productMode: "OPTION" | "SINGLE";
  desiredStatus: "SOLD_OUT" | "SELLING";
  state: string;
  stage?: string;
};

function digits(value: string) {
  return value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
}

function statusLabel(value: string | null) {
  if (value === "SOLD_OUT") return "품절";
  if (value === "SELLING") return "판매중";
  return "미반영";
}

function patternLabel(value: string) {
  if (value === "GROWTH") return "성장형";
  if (value === "STEADY_CORE") return "핵심 안정형";
  if (value === "DECLINING") return "하락형";
  if (value === "DORMANT") return "휴면형";
  return "일반형";
}

export function PurchaseV2Workspace({
  initialReport,
  initialFinalized,
  initialLifecycle,
}: {
  initialReport: PurchaseV2ClientReport;
  initialFinalized: FinalizedSummary;
  initialLifecycle: InventoryLifecycleClientSnapshot;
}) {
  const router = useRouter();
  const [cashInput, setCashInput] = useState(
    String(initialReport.maxAdditionalGrossBudgetKrw || ""),
  );
  const [report, setReport] = useState(initialReport);
  const [finalized, setFinalized] = useState(initialFinalized);
  const [lifecycle, setLifecycle] = useState(initialLifecycle);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [extensionReady, setExtensionReady] = useState(false);
  const [stockoutForm, setStockoutForm] = useState({
    barcode: "",
    modelNo: "",
    productName: "",
    productMode: "OPTION" as "OPTION" | "SINGLE",
  });

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === "COMMERCE_OS_SHOPLING_LIFECYCLE_READY") {
        setExtensionReady(true);
      }
      if (event.data.type === "COMMERCE_OS_SHOPLING_LIFECYCLE_RESULT") {
        const payload = event.data.payload as Record<string, unknown>;
        void fetch("/api/inventory-lifecycle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "SYNC_EVENT",
            ...payload,
          }),
        }).finally(() => {
          void refreshLifecycle();
        });
      }
    };
    window.addEventListener("message", handler);
    window.postMessage(
      { type: "COMMERCE_OS_SHOPLING_LIFECYCLE_PING" },
      window.location.origin,
    );
    return () => window.removeEventListener("message", handler);
  }, []);

  const recommendations = useMemo(
    () => report.rows.filter((row) => row.cashAllocatedQuantity > 0),
    [report.rows],
  );

  async function refreshLifecycle() {
    const response = await fetch("/api/inventory-lifecycle", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      snapshot?: InventoryLifecycleClientSnapshot;
    };
    if (payload.snapshot) setLifecycle(payload.snapshot);
  }

  async function preview() {
    const cashKrw = Number(cashInput || 0);
    if (!Number.isFinite(cashKrw) || cashKrw <= 0) {
      setNotice("이번 주문일에 실제 투입 가능한 현금을 입력하세요.");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/fast-purchase/v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cashKrw }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        report?: PurchaseV2ClientReport;
        message?: string;
      };
      if (payload.report) {
        setReport(payload.report);
        if (payload.report.state !== "READY") {
          setNotice(payload.report.blockers.join(" · ") || payload.report.state);
        }
      } else {
        setNotice(payload.message || "발주 V2 권장안을 계산하지 못했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function finalize() {
    const cashKrw = Number(cashInput || 0);
    if (report.state !== "READY" || cashKrw <= 0) {
      setNotice("먼저 현재 현금으로 발주 V2 권장안을 계산하세요.");
      return;
    }
    const accepted = window.confirm(
      `${money.format(report.effectiveCashKrw)}원을 이번 주문일 발주예산으로 확정합니다. 확정 스냅샷은 1688 주문·발주마감 기준이 됩니다.`,
    );
    if (!accepted) return;
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/fast-purchase/v2/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cashKrw }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        snapshot?: FinalizedSummary;
        message?: string;
      };
      if (payload.ok && payload.snapshot) {
        setFinalized(payload.snapshot);
        setNotice(payload.message || "발주안을 확정했습니다.");
        router.refresh();
      } else {
        setNotice(payload.message || "발주안 예산확정에 실패했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }

  function runExtension(job: ShoplingLifecycleJob) {
    window.postMessage(
      {
        type: "COMMERCE_OS_SHOPLING_LIFECYCLE_RUN",
        payload: job,
      },
      window.location.origin,
    );
    setNotice(
      extensionReady
        ? `${job.barcode} Shopling ${job.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} 전환을 시작했습니다.`
        : "재고 원장과 대기 작업은 저장했습니다. Shopling 재고상태 확장프로그램을 설치한 뒤 이 작업을 실행하세요.",
    );
  }

  async function stockout() {
    if (!stockoutForm.barcode.trim()) {
      setNotice("품절을 확인한 B코드를 입력하세요.");
      return;
    }
    if (stockoutForm.productMode === "SINGLE" && !stockoutForm.modelNo.trim()) {
      setNotice("단품은 A21 검색에 사용할 모델번호가 필요합니다.");
      return;
    }
    const accepted = window.confirm(
      `${stockoutForm.barcode.toUpperCase()}의 재고 기준점을 0으로 확정하고 Shopling 품절 작업을 생성합니다.`,
    );
    if (!accepted) return;
    setLoading(true);
    try {
      const response = await fetch("/api/inventory-lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "STOCKOUT",
          ...stockoutForm,
          barcode: stockoutForm.barcode.toUpperCase(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        job?: ShoplingLifecycleJob;
        message?: string;
      };
      if (payload.ok && payload.job) {
        runExtension(payload.job);
        await refreshLifecycle();
        setStockoutForm({
          barcode: "",
          modelNo: "",
          productName: "",
          productMode: "OPTION",
        });
      } else {
        setNotice(payload.message || "품절 초기화 작업을 만들지 못했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function restore(row: InventoryLifecycleClientRow) {
    const accepted = window.confirm(
      `${row.barcode}의 품절 초기화 이후 정확재고 ${money.format(row.exactInventoryQuantity ?? 0)}개를 확인했습니다. Shopling을 판매중으로 복구합니다.`,
    );
    if (!accepted) return;
    setLoading(true);
    try {
      const response = await fetch("/api/inventory-lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "RESTORE",
          barcode: row.barcode,
          modelNo: row.modelNo,
          productName: row.productName,
          productMode: row.productMode,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        job?: ShoplingLifecycleJob;
        message?: string;
      };
      if (payload.ok && payload.job) {
        runExtension(payload.job);
        await refreshLifecycle();
      } else {
        setNotice(payload.message || "판매중 복구 작업을 만들지 못했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">
              PURCHASE V2 · 44 DAYS · NO MOQ/CARTON ROUNDING
            </span>
            <h1 className="mt-1 text-2xl font-black text-slate-950">
              발주 V2 · 주문일 예산확정
            </h1>
            <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-600">
              품절기간의 잠재수요, 성장형·핵심 안정형, 가격변동, 재고 Low/High,
              미입고를 반영합니다. MOQ와 박스입수는 권장수량에서 사용하지 않으며,
              부족량 37개면 37개를 권장합니다.
            </p>
          </div>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-800">
            {extensionReady ? "Shopling 상태확장 연결됨" : "Shopling 상태확장 미연결"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="전체 지출가능금액" value={`${money.format(report.maxGrossBudgetKrw)}원`} />
          <Metric label="이미 기록된 1688 결제" value={`${money.format(report.recorded1688SpendKrw)}원`} />
          <Metric label="추가 지출가능 상한" value={`${money.format(report.maxAdditionalGrossBudgetKrw)}원`} emphasized />
        </div>

        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <label className="text-sm font-black text-amber-950">
            이번 주문일에 실제 투입 가능한 현금
          </label>
          <div className="mt-2 flex flex-col gap-2 lg:flex-row">
            <div className="relative flex-1">
              <input
                inputMode="numeric"
                value={cashInput ? money.format(Number(cashInput)) : ""}
                onChange={(event) => setCashInput(digits(event.target.value))}
                className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3 pr-12 text-right text-lg font-black outline-none focus:border-amber-500"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500">원</span>
            </div>
            <button
              type="button"
              onClick={preview}
              disabled={loading}
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:bg-slate-400"
            >
              {loading ? "처리 중..." : "V2 권장안 계산"}
            </button>
            <button
              type="button"
              onClick={finalize}
              disabled={loading || report.state !== "READY"}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white disabled:bg-slate-400"
            >
              주문일 예산·권장안 확정
            </button>
          </div>
        </div>

        {notice ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-950">
            {notice}
          </p>
        ) : null}

        {report.state === "READY" ? (
          <>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
              <ResultMetric label="적용 현금" value={`${money.format(report.effectiveCashKrw)}원`} />
              <ResultMetric label="상품대금 한도" value={`${money.format(report.productOrderBudgetKrw)}원`} />
              <ResultMetric label="예상 상품대금" value={`${money.format(report.expectedProductSpendKrw)}원`} />
              <ResultMetric label="예상 총비용" value={`${money.format(report.expectedAllInSpendKrw)}원`} />
              <ResultMetric label="권장 SKU" value={`${money.format(report.recommendedSkuCount)}개`} />
              <ResultMetric label="수동검토" value={`${money.format(report.manualReviewSkuCount)}개`} />
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[1250px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-3">순위</th>
                    <th className="px-3 py-3">B-code / 상품</th>
                    <th className="px-3 py-3">유형</th>
                    <th className="px-3 py-3">판정</th>
                    <th className="px-3 py-3 text-right">최근30일</th>
                    <th className="px-3 py-3 text-right">44일 목표</th>
                    <th className="px-3 py-3 text-right">재고범위</th>
                    <th className="px-3 py-3 text-right">미입고</th>
                    <th className="px-3 py-3 text-right">필요수량</th>
                    <th className="px-3 py-3 text-right">현금배정</th>
                    <th className="px-3 py-3 text-right">상품대금</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {recommendations.slice(0, 80).map((row, index) => (
                    <tr key={row.barcode}>
                      <td className="px-3 py-3 font-black text-blue-700">{index + 1}</td>
                      <td className="px-3 py-3">
                        <strong className="font-mono text-slate-950">{row.barcode}</strong>
                        <span className="ml-2 text-slate-500">{row.modelNo ? `${row.modelNo} · ` : ""}{row.productName}</span>
                        <p className="mt-1 max-w-xl text-[11px] leading-5 text-slate-500">{row.reason}</p>
                      </td>
                      <td className="px-3 py-3 font-bold">{patternLabel(row.pattern)}</td>
                      <td className="px-3 py-3">{row.group}</td>
                      <td className="px-3 py-3 text-right">{money.format(row.observedRecent30Units)}{row.stockoutRecoveredUnits > 0 ? ` → ${money.format(row.adjustedRecent30Units)}` : ""}</td>
                      <td className="px-3 py-3 text-right font-bold">{money.format(row.targetDemand44Days)}</td>
                      <td className="px-3 py-3 text-right">{row.exactInventoryKnown ? money.format(row.inventoryHighQuantity ?? 0) : `${money.format(row.inventoryLowQuantity ?? 0)}~${money.format(row.inventoryHighQuantity ?? 0)}`}</td>
                      <td className="px-3 py-3 text-right">{money.format(row.openCommitment)}</td>
                      <td className="px-3 py-3 text-right">{money.format(row.preBudgetRecommendedQuantity)}</td>
                      <td className="px-3 py-3 text-right font-black text-blue-700">{money.format(row.cashAllocatedQuantity)}</td>
                      <td className="px-3 py-3 text-right font-bold">{money.format(row.expectedAllocatedProductCostKrw)}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
            {report.blockers.join(" · ") || "발주 V2 계산이 차단됐습니다."}
          </p>
        )}

        {finalized ? (
          <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
            <strong>현재 주문일 확정안</strong> · {new Date(finalized.finalizedAt).toLocaleString("ko-KR")} · 현금 {money.format(finalized.cashKrw)}원 · 권장 {finalized.report.recommendedSkuCount} SKU
            <p className="break-all text-[11px] text-emerald-800">{finalized.reportFingerprint}</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-violet-700">INVENTORY RESET · SHOPLING STATUS</span>
            <h2 className="mt-1 text-xl font-black text-slate-950">B코드 품절 초기화·입고 후 판매중 복구</h2>
            <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-600">
              품절을 확인하면 재고 기준점을 0으로 고정합니다. 이후 확정입고 증가분에서 실제 판매를 차감해 정확재고를 계산하고, 양수 재고가 확인되면 판매중 복구 대상을 올립니다. Shopling 외부반영 실패는 재고 사실을 되돌리지 않습니다.
            </p>
          </div>
          <a
            href="/api/shopling-inventory-lifecycle-extension/download"
            className="rounded-xl border border-violet-300 bg-violet-50 px-4 py-2 text-xs font-black text-violet-900"
          >
            Shopling 재고상태 확장 다운로드
          </a>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-5">
          <input
            value={stockoutForm.barcode}
            onChange={(event) => setStockoutForm((current) => ({ ...current, barcode: event.target.value.toUpperCase() }))}
            placeholder="B코드 예: BCC3-2"
            className="rounded-xl border border-slate-300 px-3 py-3 text-sm font-bold"
          />
          <input
            value={stockoutForm.modelNo}
            onChange={(event) => setStockoutForm((current) => ({ ...current, modelNo: event.target.value }))}
            placeholder="모델번호 · 단품 필수"
            className="rounded-xl border border-slate-300 px-3 py-3 text-sm"
          />
          <input
            value={stockoutForm.productName}
            onChange={(event) => setStockoutForm((current) => ({ ...current, productName: event.target.value }))}
            placeholder="상품명 · 선택"
            className="rounded-xl border border-slate-300 px-3 py-3 text-sm"
          />
          <select
            value={stockoutForm.productMode}
            onChange={(event) => setStockoutForm((current) => ({ ...current, productMode: event.target.value as "OPTION" | "SINGLE" }))}
            className="rounded-xl border border-slate-300 px-3 py-3 text-sm font-bold"
          >
            <option value="OPTION">옵션상품 · A6 → A22</option>
            <option value="SINGLE">단품 · A6 → A21</option>
          </select>
          <button
            type="button"
            onClick={stockout}
            disabled={loading}
            className="rounded-xl bg-rose-600 px-4 py-3 text-sm font-black text-white disabled:bg-slate-400"
          >
            재고 0 확정·품절 실행
          </button>
        </div>

        {lifecycle.blockers.length ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-950">{lifecycle.blockers.join(" · ")}</p>
        ) : null}

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[1050px] text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-3">B코드 / 상품</th>
                <th className="px-3 py-3">방식</th>
                <th className="px-3 py-3">0 기준일</th>
                <th className="px-3 py-3 text-right">이후 입고</th>
                <th className="px-3 py-3 text-right">이후 판매</th>
                <th className="px-3 py-3 text-right">정확재고</th>
                <th className="px-3 py-3">Shopling</th>
                <th className="px-3 py-3">다음 작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {lifecycle.rows.map((row) => (
                <tr key={`${row.barcode}:${row.resetAt}`}>
                  <td className="px-3 py-3">
                    <strong className="font-mono text-slate-950">{row.barcode}</strong>
                    <span className="ml-2 text-slate-500">{row.modelNo ? `${row.modelNo} · ` : ""}{row.productName}</span>
                  </td>
                  <td className="px-3 py-3 font-bold">{row.productMode === "OPTION" ? "A6→A22" : "A6→A21"}</td>
                  <td className="px-3 py-3">{new Date(row.resetAt).toLocaleString("ko-KR")}</td>
                  <td className="px-3 py-3 text-right">{money.format(row.inboundAfterReset)}</td>
                  <td className="px-3 py-3 text-right">{money.format(row.salesAfterReset)}</td>
                  <td className="px-3 py-3 text-right font-black">{row.exactInventoryKnown ? `${money.format(row.exactInventoryQuantity ?? 0)}개` : "검증 대기"}</td>
                  <td className="px-3 py-3">{statusLabel(row.latestSuccessfulShoplingStatus)} · {row.latestShoplingSyncState ?? "없음"}</td>
                  <td className="px-3 py-3">
                    {row.nextRecommendedSync === "SELLING" ? (
                      <button type="button" onClick={() => restore(row)} disabled={loading} className="rounded-lg bg-emerald-600 px-3 py-2 font-black text-white disabled:bg-slate-400">입고확정 · 판매중 복구</button>
                    ) : row.pendingJobId ? (
                      <span className="font-bold text-amber-700">외부반영 대기</span>
                    ) : (
                      <span className="text-slate-400">없음</span>
                    )}
                  </td>
                </tr>
              ))}
              {!lifecycle.rows.length ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">아직 품절 초기화한 B코드가 없습니다.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return <div className={`rounded-xl border p-4 ${emphasized ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}><span className="text-[11px] font-bold text-slate-500">{label}</span><strong className="mt-1 block text-lg font-black text-slate-950">{value}</strong></div>;
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><span className="text-[11px] font-bold text-blue-700">{label}</span><strong className="mt-1 block text-base font-black text-slate-950">{value}</strong></div>;
}
