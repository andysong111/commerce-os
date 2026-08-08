import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function InventoryVerificationPriorityPage() {
  const report = await loadInventoryVerificationPriority();
  const purchaseRows = report.rows.filter((row) => row.purchaseStatus === "발주 추천");
  const blockedRows = purchaseRows.filter((row) => !row.operationallyReady);
  const stocktakeRows = blockedRows.filter((row) => row.action === "STOCKTAKE_REQUIRED");
  const priorityRows = blockedRows.slice(0, report.priorityStocktakeCountFor80PctBlockedSpend);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · INVENTORY TRUST"
        title="발주후보 재고확인 우선순위"
        description="332개 전체를 무작정 실사하지 않고 Canonical 발주 shadow의 실제 발주후보만 재고·원가 원장과 결합해 기대발주금액이 큰 순서로 확인 대상을 최소화합니다. 이 화면은 읽기 전용이며 재고를 수정하지 않습니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/stage8-canonical-purchase-shadow" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Canonical 발주 Shadow</Link>
            <Link href="/product-master/inventory-cost-readiness" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">재고·원가 신뢰도</Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="발주후보" value={number.format(report.purchaseRecommendationCount)} />
        <Metric label="운영가능" value={number.format(report.verifiedPurchaseRecommendationCount)} />
        <Metric label="재고확인 차단" value={number.format(report.blockedPurchaseRecommendationCount)} />
        <Metric label="전체 예상발주" value={`${number.format(report.totalExpectedSpend)}원`} />
        <Metric label="실제 쓰기" value="0 · READ ONLY" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="운영가능 예상발주" value={`${number.format(report.operationallyReadyExpectedSpend)}원`} />
        <Metric label="차단 예상발주" value={`${number.format(report.blockedExpectedSpend)}원`} />
        <Metric label="우선 실사 80% 커버 SKU" value={number.format(report.priorityStocktakeCountFor80PctBlockedSpend)} />
        <Metric label="우선 실사 커버금액" value={`${number.format(report.priorityStocktakeExpectedSpendCoverage)}원`} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold tracking-wide text-slate-500">MINIMUM PHYSICAL VERIFICATION</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state === "READY" ? "PRIORITY QUEUE READY" : "STRUCTURAL BLOCK"}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">발주 실행 차단 유지</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-3 text-xs leading-5 text-slate-600">
          80% 커버 수치는 작업량을 줄이기 위한 우선순위일 뿐입니다. 실사하지 않은 SKU를 0재고로 간주하거나 자동 발주에 포함하지 않습니다.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">우선 확인 묶음 · 차단금액 약 80%</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">예상발주금액이 큰 미확인 발주후보부터 최소 묶음으로 잡습니다.</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{number.format(priorityRows.length)}개 SKU</span>
        </div>
        <InventoryTable rows={priorityRows} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">발주후보 전체 차단 사유</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">재고 실사·원장 검토·입고원가 확인 중 무엇이 필요한지 1개 행동으로 분류합니다.</p>
          </div>
          <span className="text-xs font-bold text-slate-500">실사 필요 {number.format(stocktakeRows.length)}개 · 전체 차단 {number.format(blockedRows.length)}개</span>
        </div>
        <InventoryTable rows={blockedRows} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
        <strong>판정 규칙</strong><br />
        1. 재고 raw 계산이 음수/검토 상태면 원장 검토 우선.<br />
        2. STOCKTAKE 또는 SOLD_OUT_RESET 기준점이 없으면 초기 0을 실제 재고로 믿지 않고 실사 필요.<br />
        3. 재고가 확인돼도 확정 입고원가가 없으면 실제 발주/가격 판단에서 차단.<br />
        4. 발주후보가 아닌 SKU는 현재 직접행동 우선순위에서 제외.<br />
        5. 향후 부분 실행은 <strong>검증된 SKU만 독립적으로 잠금 해제</strong>하고 나머지는 계속 차단하는 구조로 진행합니다.
      </section>
    </div>
  );
}

type Row = Awaited<ReturnType<typeof loadInventoryVerificationPriority>>["rows"][number];

function InventoryTable({ rows }: { rows: Row[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="min-w-[1400px] text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="px-3 py-2">바코드</th>
            <th className="px-3 py-2">상품</th>
            <th className="px-3 py-2">행동</th>
            <th className="px-3 py-2">권장수량</th>
            <th className="px-3 py-2">예상발주금액</th>
            <th className="px-3 py-2">재고</th>
            <th className="px-3 py-2">재고상태</th>
            <th className="px-3 py-2">기준점</th>
            <th className="px-3 py-2">이동/입고</th>
            <th className="px-3 py-2">확정원가</th>
            <th className="px-3 py-2">보호원가</th>
            <th className="px-3 py-2">점수</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.barcode} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2 font-mono font-black text-slate-950">{row.barcode}</td>
              <td className="px-3 py-2"><strong>{row.name}</strong><br /><span className="text-slate-400">{row.modelNo ?? "-"}</span></td>
              <td className="px-3 py-2 font-black">{actionLabel(row.action)}</td>
              <td className="px-3 py-2">{number.format(row.recommendedQty)}</td>
              <td className="px-3 py-2 font-black">{number.format(row.expectedCost)}원</td>
              <td className="px-3 py-2">{number.format(row.inventoryQuantity)}</td>
              <td className="px-3 py-2">{row.inventoryVerification}{row.inventoryRequiresReview ? " · REVIEW" : ""}</td>
              <td className="px-3 py-2">{row.inventoryBaselineKind ?? "없음"}</td>
              <td className="px-3 py-2">{number.format(row.movementCount)} / INBOUND {number.format(row.inboundMovementCount)}</td>
              <td className="px-3 py-2">{row.hasConfirmedReceiptCost ? `${number.format(row.latestConfirmedReceiptCostKrw)}원` : "없음"}</td>
              <td className="px-3 py-2">{number.format(row.protectedCostKrw)}원</td>
              <td className="px-3 py-2">{number.format(row.priorityScore)}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr><td colSpan={12} className="px-3 py-10 text-center font-bold text-emerald-700">현재 해당 확인 대상이 없습니다.</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function actionLabel(action: Row["action"]) {
  if (action === "STOCKTAKE_REQUIRED") return "실사 필요";
  if (action === "LEDGER_REVIEW_REQUIRED") return "원장 검토";
  if (action === "COST_CONFIRMATION_REQUIRED") return "입고원가 확인";
  return "준비 완료";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block break-all text-lg text-slate-950">{value}</strong>
    </article>
  );
}
