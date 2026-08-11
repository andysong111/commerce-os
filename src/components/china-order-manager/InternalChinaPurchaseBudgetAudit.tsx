import type { InternalChinaPurchaseBudgetAudit as BudgetAudit } from "@/lib/internalChinaPurchaseBudgetAudit";

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function tone(status: BudgetAudit["status"]) {
  if (status === "OVER_BUDGET") {
    return "border-rose-300 bg-rose-50 text-rose-950";
  }
  if (status === "COST_REVIEW") {
    return "border-amber-300 bg-amber-50 text-amber-950";
  }
  return "border-emerald-300 bg-emerald-50 text-emerald-950";
}

function statusLabel(status: BudgetAudit["status"]) {
  if (status === "OVER_BUDGET") return "예산 초과 · 주문 전 조정 필요";
  if (status === "COST_REVIEW") return "기준원가 확인 필요";
  return "예산 범위 내";
}

export function InternalChinaPurchaseBudgetAudit({
  audit,
}: {
  audit: BudgetAudit;
}) {
  return (
    <section className={`rounded-2xl border p-5 shadow-sm ${tone(audit.status)}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em]">
            MONTHLY PURCHASE BUDGET AUDIT
          </span>
          <h2 className="mt-1 text-xl font-black">전월 매출원가 기준 발주예산 검증</h2>
          <p className="mt-2 max-w-5xl text-sm leading-6 opacity-80">
            현재 발주 엔진은 최근 30일 정상매출의 50%를 매출원가 예산으로 잡고,
            배송대행·물류 포함 배수 {audit.purchaseCostMultiplier.toFixed(2)}를 역산해
            실제 상품대금 한도를 정합니다. 아래 금액은 1688 실제 단가를 입력하기 전
            Product Master/발주엔진 기준원가로 계산한 사전 검증값입니다.
          </p>
        </div>
        <span className="rounded-full border border-current/20 bg-white/70 px-3 py-1.5 text-xs font-black">
          {statusLabel(audit.status)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric
          label="최근30일 정상매출"
          value={`${money.format(audit.recent30RevenueKrw)}원`}
        />
        <Metric
          label="매출원가 총예산"
          value={`${money.format(audit.grossCogsBudgetKrw)}원`}
          note="정상매출 ÷ 2"
        />
        <Metric
          label="상품대금 발주한도"
          value={`${money.format(audit.productOrderBudgetKrw)}원`}
          note={`총예산 ÷ ${audit.purchaseCostMultiplier.toFixed(2)}`}
        />
        <Metric
          label="현재 Draft 추정 상품대금"
          value={`${money.format(audit.selectedDraftEstimatedProductCostKrw)}원`}
          note={`${percent.format(audit.selectedDraftBudgetUtilizationPercent)}% 사용`}
          emphasized
        />
        <Metric
          label="물류배수 포함 추정원가"
          value={`${money.format(audit.selectedDraftEstimatedLandedCostKrw)}원`}
          note="사전 추정치"
        />
        <Metric
          label={audit.selectedDraftBudgetOverKrw > 0 ? "예산 초과" : "상품대금 잔여예산"}
          value={`${money.format(
            audit.selectedDraftBudgetOverKrw > 0
              ? audit.selectedDraftBudgetOverKrw
              : audit.selectedDraftBudgetRemainingKrw,
          )}원`}
          danger={audit.selectedDraftBudgetOverKrw > 0}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <InfoBox
          title="엔진 원배분"
          body={`예산 배분 후 엔진 예상 상품대금 ${money.format(
            audit.engineExpectedSpendKrw,
          )}원 · 현재 Draft에서 엔진 수량과 달라진 SKU ${audit.quantityChangedFromEngineCount}개 (증가 ${audit.quantityAboveEngineCount} · 감소 ${audit.quantityBelowEngineCount})`}
        />
        <InfoBox
          title="다른 활성 Draft"
          body={
            audit.otherActiveDraftCount > 0
              ? `선택한 Draft 외 ${audit.otherActiveDraftCount}건 · 미입고 ${money.format(
                  audit.otherActiveDraftQuantity,
                )}개 · 기준원가 추정 ${money.format(
                  audit.otherActiveDraftEstimatedProductCostKrw,
                )}원. 실제 주문하지 않을 과거 Draft라면 이후 해제해야 다음 발주 계산이 왜곡되지 않습니다.`
              : "선택한 Draft 외 활성 RESERVED Draft가 없습니다."
          }
        />
        <InfoBox
          title="기준원가 커버리지"
          body={
            audit.missingCostBarcodes.length
              ? `${audit.missingCostBarcodes.length}개 SKU의 기준원가를 확인하지 못했습니다: ${audit.missingCostBarcodes
                  .slice(0, 6)
                  .join(", ")}${audit.missingCostBarcodes.length > 6 ? " …" : ""}`
              : "현재 Draft의 모든 SKU에서 예산 검증용 기준원가를 확보했습니다."
          }
        />
      </div>

      <p className="mt-4 rounded-xl border border-current/15 bg-white/60 px-4 py-3 text-xs leading-5 opacity-80">
        기준식 · {audit.basisLabel}. 실제 주문 직전에는 아래 노란 칸의 1688 위안단가와 중국내 운임을 입력해 화면의 실제 예상 지급액도 함께 확인하세요. 예산 검증과 실제 지급액 검증 두 조건을 모두 만족한 뒤 주문합니다.
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  note,
  emphasized = false,
  danger = false,
}: {
  label: string;
  value: string;
  note?: string;
  emphasized?: boolean;
  danger?: boolean;
}) {
  return (
    <article className="rounded-xl border border-current/10 bg-white/75 p-4">
      <p className="text-xs font-bold opacity-60">{label}</p>
      <strong
        className={`mt-1 block text-lg font-black ${
          danger ? "text-rose-700" : emphasized ? "text-blue-700" : ""
        }`}
      >
        {value}
      </strong>
      {note ? <p className="mt-1 text-[11px] opacity-60">{note}</p> : null}
    </article>
  );
}

function InfoBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-current/10 bg-white/60 p-4 text-xs leading-5">
      <strong className="block text-sm">{title}</strong>
      <p className="mt-1 opacity-75">{body}</p>
    </div>
  );
}
