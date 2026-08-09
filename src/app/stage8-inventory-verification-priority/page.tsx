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
  const provisionalRows = purchaseRows.filter(
    (row) => row.inventoryMode === "PROVISIONAL",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PROVISIONAL INVENTORY"
        title="발주후보 추정재고·원가 준비도"
        description="전체 재고실사를 요구하지 않습니다. INITIAL_ZERO 상품도 Product Master 원장의 현재 계산수량을 PROVISIONAL 추정재고로 사용하고, 확정입고는 수량·원가에 누적합니다. 실제 품절 확인 시 SOLD_OUT_RESET=0부터 VERIFIED 재고로 전환합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/stage8-canonical-purchase-shadow" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Canonical 발주 Shadow</Link>
            <Link href="/product-master/inventory-cost-readiness" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">재고·원가 원장</Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="발주후보" value={number.format(report.purchaseRecommendationCount)} />
        <Metric label="운영가능" value={number.format(report.operationallyReadyPurchaseCount)} />
        <Metric label="PROVISIONAL" value={number.format(report.provisionalPurchaseCount)} />
        <Metric label="VERIFIED" value={number.format(report.verifiedPurchaseCount)} />
        <Metric label="재고실사 필수" value="0" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="전체 예상발주" value={`${number.format(report.totalExpectedSpend)}원`} />
        <Metric label="운영가능 예상발주" value={`${number.format(report.operationallyReadyExpectedSpend)}원`} />
        <Metric label="원가/원장 차단금액" value={`${number.format(report.blockedExpectedSpend)}원`} />
        <Metric label="원장 REVIEW" value={number.format(report.reviewInventoryCount)} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold tracking-wide text-slate-500">NO FULL STOCKTAKE POLICY</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state === "READY" ? "PROVISIONAL INVENTORY READY" : "STRUCTURAL BLOCK"}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">실사 없이 추정재고 사용</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-3 text-xs leading-5 text-slate-600">
          INITIAL_ZERO의 0은 실제 재고 0이라는 뜻이 아닙니다. 단지 기준점이 아직 없다는 뜻이며, 발주 계산에는 현재 원장 계산수량을 추정치로 사용합니다. 품절·실사 기준점이 생긴 SKU만 VERIFIED로 승격됩니다.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">추정재고로 계산된 발주후보</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">기존 gross 권장수량에서 PROVISIONAL/VERIFIED 재고와 중국 미입고 약정을 다시 차감해 실제 다음 발주수량을 계산합니다.</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{number.format(provisionalRows.length)}개 SKU</span>
        </div>
        <InventoryTable rows={provisionalRows} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">아직 차단된 발주후보</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">차단 사유는 재고실사 부족이 아니라 원장 REVIEW 또는 확정 입고원가 부족입니다.</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{number.format(blockedRows.length)}개 SKU</span>
        </div>
        <InventoryTable rows={blockedRows} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
        <strong>운영 규칙</strong><br />
        1. INITIAL_ZERO/UNVERIFIED라도 원장이 음수가 아니면 PROVISIONAL 추정재고로 발주 계산에 사용합니다.<br />
        2. 확정입고가 발생하면 INBOUND 수량과 확정 입고원가가 같은 SKU 원장에 추가됩니다.<br />
        3. 품절이 실제 확인되면 SOLD_OUT_RESET=0을 기준점으로 만들고 그 이후 입고·판매부터 VERIFIED 재고로 운영합니다.<br />
        4. 원장 음수·identity 충돌은 REVIEW로 차단합니다. STOCKTAKE는 오류 교정용 선택 기능이지 필수 절차가 아닙니다.<br />
        5. 확정 입고원가는 재고 신뢰도와 별개로 발주·가격 판단의 비용 게이트로 유지합니다.
      </section>
    </div>
  );
}

type Row = Awaited<ReturnType<typeof loadInventoryVerificationPriority>>["rows"][number];

function InventoryTable({ rows }: { rows: Row[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="min-w-[1500px] text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="px-3 py-2">바코드</th>
            <th className="px-3 py-2">상품</th>
            <th className="px-3 py-2">재고모드</th>
            <th className="px-3 py-2">행동</th>
            <th className="px-3 py-2">기존 권장</th>
            <th className="px-3 py-2">추정재고 반영 권장</th>
            <th className="px-3 py-2">예상발주금액</th>
            <th className="px-3 py-2">추정재고</th>
            <th className="px-3 py-2">미입고 약정</th>
            <th className="px-3 py-2">기준점</th>
            <th className="px-3 py-2">이동/입고</th>
            <th className="px-3 py-2">확정원가</th>
            <th className="px-3 py-2">보호원가</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.barcode} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2 font-mono font-black text-slate-950">{row.barcode}</td>
              <td className="px-3 py-2"><strong>{row.name}</strong><br /><span className="text-slate-400">{row.modelNo ?? "-"}</span></td>
              <td className="px-3 py-2 font-black">{row.inventoryMode}</td>
              <td className="px-3 py-2 font-black">{actionLabel(row.action)}</td>
              <td className="px-3 py-2">{number.format(row.originalRecommendedQty)}</td>
              <td className="px-3 py-2 font-black">{number.format(row.recommendedQty)}</td>
              <td className="px-3 py-2 font-black">{number.format(row.expectedCost)}원</td>
              <td className="px-3 py-2">{number.format(row.inventoryQuantity)}</td>
              <td className="px-3 py-2">{number.format(row.openCommitment)}</td>
              <td className="px-3 py-2">{row.inventoryBaselineKind ?? "없음"}</td>
              <td className="px-3 py-2">{number.format(row.movementCount)} / INBOUND {number.format(row.inboundMovementCount)}</td>
              <td className="px-3 py-2">{row.hasConfirmedReceiptCost ? `${number.format(row.latestConfirmedReceiptCostKrw)}원` : "없음"}</td>
              <td className="px-3 py-2">{number.format(row.protectedCostKrw)}원</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr><td colSpan={13} className="px-3 py-10 text-center font-bold text-emerald-700">현재 해당 대상이 없습니다.</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function actionLabel(action: Row["action"]) {
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
