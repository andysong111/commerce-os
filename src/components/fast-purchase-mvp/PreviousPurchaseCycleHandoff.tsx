import type { InternalChinaPurchaseCycleHandoff } from "@/lib/internalChinaPurchaseCycleHandoff";
import { koreanMonthLabel } from "@/lib/monthlyPurchasePolicy";

const number = new Intl.NumberFormat("ko-KR");
const foreignBalance = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type StageState = "COMPLETE" | "NEEDS_CHECK" | "NOT_AVAILABLE";

function stateLabel(state: StageState) {
  if (state === "COMPLETE") return "완료";
  if (state === "NEEDS_CHECK") return "확인 필요";
  return "정보 없음";
}

function stateClass(state: StageState) {
  if (state === "COMPLETE") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (state === "NEEDS_CHECK") return "border-amber-300 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function PreviousPurchaseCycleHandoff({
  handoff,
}: {
  handoff: InternalChinaPurchaseCycleHandoff;
}) {
  const funding = handoff.fundingClose;
  const price = handoff.priceVerification;
  const allCoreClosed =
    handoff.receiptState === "COMPLETE" &&
    handoff.landedCostState === "COMPLETE" &&
    handoff.fundingState === "COMPLETE" &&
    price.state === "COMPLETE";

  return (
    <section className="rounded-2xl border border-cyan-200 bg-gradient-to-r from-cyan-50 to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-cyan-700">
            PREVIOUS CYCLE → CURRENT PURCHASE INPUT
          </span>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            {koreanMonthLabel(handoff.previousCycleMonth)} 마감 → {koreanMonthLabel(handoff.currentCycleMonth)} 발주 연결
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            직전 발주·입고·확정원가·자금·가격검증 상태를 한 번에 확인하고, 이번 발주 수량에 실제로 영향을 주는 미입고 수량을 분리해서 보여줍니다.
          </p>
        </div>
        <strong
          className={`rounded-full border px-3 py-1 text-xs font-black ${
            allCoreClosed
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {allCoreClosed ? "직전 사이클 정상 마감" : "일부 마감상태 확인 필요"}
        </strong>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StageCard
          label="입고"
          state={handoff.receiptState}
          detail={
            handoff.draftCount > 0
              ? `${number.format(handoff.receivedQuantity)} / ${number.format(handoff.orderedQuantity)}개`
              : "직전 실주문 Draft 없음"
          }
        />
        <StageCard
          label="미입고"
          state={handoff.quantityImpactReady && handoff.openQuantity === 0 ? "COMPLETE" : handoff.receiptState}
          detail={`${number.format(handoff.openQuantity)}개`}
          emphasized
        />
        <StageCard
          label="확정원가"
          state={handoff.landedCostState}
          detail={stateLabel(handoff.landedCostState)}
        />
        <StageCard
          label="자금마감"
          state={handoff.fundingState}
          detail={funding ? `${number.format(funding.emergencyReserveTransferKrw)}원 비상금` : stateLabel(handoff.fundingState)}
        />
        <StageCard
          label="Shopling 가격검증"
          state={price.state}
          detail={
            price.fingerprint
              ? `${number.format(price.verifiedGoodsKeyCount)}/${number.format(price.goodsKeyCount)} GOODSKEY · ${number.format(price.matchedMallPriceCount)}/${number.format(price.totalMallTargetCount)} 몰가격`
              : stateLabel(price.state)
          }
        />
      </div>

      <p className="mt-3 rounded-xl border border-cyan-200 bg-white px-4 py-3 text-xs font-black leading-5 text-cyan-950">
        이번 발주 수량 계산에는 직전 사이클의 <strong>미입고 {number.format(handoff.openQuantity)}개</strong>만 기존 약정 원장을 통해 차감됩니다. WorldFirst 기말잔액·한국계좌 비상금·가격검증 결과는 조회 정보이며 이번 월 발주예산이나 권장수량을 자동으로 더하거나 빼지 않습니다.
      </p>

      {funding ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FundingCard
            label="직전 전체 지출가능금액"
            value={`${number.format(funding.totalSpendingBudgetKrw)}원`}
          />
          <FundingCard
            label="WorldFirst 배정"
            value={`${number.format(funding.worldFirstTransferKrw)}원`}
          />
          <FundingCard
            label="WorldFirst 기말잔액"
            value={`USD ${foreignBalance.format(funding.worldFirstEndingUsd)} · CNH ${foreignBalance.format(funding.worldFirstEndingCnh)}`}
          />
          <FundingCard
            label="한국계좌 비상금 적립"
            value={`${number.format(funding.emergencyReserveTransferKrw)}원`}
            emphasized
          />
        </div>
      ) : null}

      {handoff.warnings.length ? (
        <details className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          <summary className="cursor-pointer font-black">조회 경고 {handoff.warnings.length}건</summary>
          <ul className="mt-2 space-y-1">
            {handoff.warnings.map((warning) => (
              <li key={warning}>· {warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function StageCard({
  label,
  state,
  detail,
  emphasized = false,
}: {
  label: string;
  state: StageState;
  detail: string;
  emphasized?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border p-4 ${stateClass(state)} ${
        emphasized ? "ring-2 ring-cyan-200" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black">{label}</span>
        <span className="rounded-full border border-current/20 bg-white/70 px-2 py-0.5 text-[10px] font-black">
          {stateLabel(state)}
        </span>
      </div>
      <strong className="mt-2 block text-sm font-black leading-5">{detail}</strong>
    </article>
  );
}

function FundingCard({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border bg-white p-3 ${
        emphasized ? "border-emerald-400" : "border-cyan-200"
      }`}
    >
      <span className="block text-[11px] font-bold text-slate-500">{label}</span>
      <strong
        className={`mt-1 block text-sm font-black ${
          emphasized ? "text-emerald-800" : "text-slate-950"
        }`}
      >
        {value}
      </strong>
    </article>
  );
}
