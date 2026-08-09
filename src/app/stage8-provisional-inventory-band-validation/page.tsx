import { PageHeader } from "@/components/PageHeader";
import { loadProvisionalInventoryBandValidation } from "@/lib/stage8ProvisionalInventoryBandValidation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8ProvisionalInventoryBandValidationPage() {
  const validation = await loadProvisionalInventoryBandValidation();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PROVISIONAL INVENTORY BAND"
        title="추정재고 불확실성 밴드 검증"
        description="정확하지 않은 재고를 한 숫자로 억지 확정하지 않고, 서로 다른 디지털 추정후보 사이에서 발주판단이 얼마나 흔들리는지 먼저 확인합니다. BGG1-1 실물 3,000개는 검증 답안으로만 사용합니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={validation.state} />
        <Metric label="대상" value={validation.barcode} />
        <Metric label="진단 낮은값" value={`${number.format(validation.diagnosticLowQuantity)}개`} />
        <Metric label="진단 높은값" value={`${number.format(validation.diagnosticHighQuantity)}개`} />
        <Metric label="실물 검증" value={`${number.format(validation.physicalQuantity)}개`} />
        <Metric label="재고/발주 write" value="0 · READ ONLY" />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${validation.physicalInsideDiagnosticBand ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        <span className="text-xs font-black tracking-[0.14em] text-slate-600">
          DIAGNOSTIC BAND · NOT PROVEN INVENTORY BOUNDS
        </span>
        <h2 className="mt-1 text-xl font-black text-slate-950">
          {validation.barcode} · {validation.productName}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">{validation.message}</p>
        <p className="mt-3 text-sm font-bold text-slate-900">
          실물 3,000개가 진단 밴드 안에 있는가? · {validation.physicalInsideDiagnosticBand ? "YES" : "NO"}
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <DecisionCard
          title="낮은 재고 가정"
          stock={validation.diagnosticLowQuantity}
          qty={validation.lowInventoryRecommendedQty}
          status={validation.lowInventoryPurchaseStatus}
          note={`최신 과거발주 잔여후보 · ${validation.operatingLeadDays}일 운영 리드타임 가정`}
        />
        <DecisionCard
          title="실물 정답 검증"
          stock={validation.physicalQuantity}
          qty={validation.physicalInventoryRecommendedQty}
          status={validation.physicalInventoryPurchaseStatus}
          note={`검증표본 · ${validation.physicalObservedOn}`}
        />
        <DecisionCard
          title="높은 재고 가정"
          stock={validation.diagnosticHighQuantity}
          qty={validation.highInventoryRecommendedQty}
          status={validation.highInventoryPurchaseStatus}
          note="누적발주 - Canonical 360일 판매 진단후보"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="수요 목표" value={`${number.format(validation.rawDemandTarget)}개`} />
          <Metric label="미입고 약정" value={`${number.format(validation.openCommitment)}개`} />
          <Metric label="기존 발주상태" value={validation.originalPurchaseStatus || "-"} />
          <Metric label="발주방향 안정성" value={validation.decisionStability} />
          <Metric label="운영 승격" value="OFF" />
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          낮은값과 높은값에서 발주 방향이 같으면 재고 오차에 덜 민감한 상품이라는 뜻입니다. 방향이 달라지면 실제 재고를 모르고 자동 발주하기 위험한 상품이므로 HOLD하는 쪽이 안전합니다.
        </p>
      </section>

      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-900 shadow-sm">
        <strong>현재는 검증 전용.</strong> 이 두 값은 아직 수학적으로 증명된 실제 재고 상·하한이 아닙니다. 실물 3,000개가 사이에 들어오는지와 발주 방향 민감도를 검증하는 단계이며, Product Master 재고·중국 발주·샵플링 가격에는 쓰지 않습니다.
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-xs leading-6 text-slate-600">
        최신발주 잔여후보 · {number.format(validation.latestOrderResidualCandidate)}개 · 누적발주 잔여후보 · {number.format(validation.cumulativeOrderResidualCandidate)}개
        <br />검증 지문 · <span className="break-all">{validation.fingerprint}</span>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block break-all text-lg text-slate-950">{value}</strong>
    </article>
  );
}

function DecisionCard({
  title,
  stock,
  qty,
  status,
  note,
}: {
  title: string;
  stock: number;
  qty: number;
  status: string;
  note: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <span className="text-xs font-black tracking-[0.12em] text-slate-500">{title}</span>
      <strong className="mt-2 block text-2xl text-slate-950">재고 {number.format(stock)}개</strong>
      <p className="mt-3 text-sm text-slate-700">발주결과 · <b>{status || "-"}</b></p>
      <p className="text-sm text-slate-700">권장수량 · <b>{number.format(qty)}개</b></p>
      <p className="mt-3 text-xs leading-5 text-slate-500">{note}</p>
    </article>
  );
}
