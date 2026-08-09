import { PageHeader } from "@/components/PageHeader";
import { loadCurrentProvisionalDecisionEnvelope } from "@/lib/stage8ProvisionalDecisionEnvelope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8ProvisionalDecisionEnvelopePage() {
  const result = await loadCurrentProvisionalDecisionEnvelope();
  const stateTone =
    result.state === "ORDER_DIRECTION_STABLE"
      ? "border-emerald-200 bg-emerald-50"
      : result.state === "HOLD_DIRECTION_STABLE"
        ? "border-sky-200 bg-sky-50"
        : result.state === "INVENTORY_SENSITIVE"
          ? "border-amber-200 bg-amber-50"
          : "border-rose-200 bg-rose-50";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PROVISIONAL DECISION ENVELOPE"
        title="추정재고 발주방향 안전 게이트"
        description="정확한 재고 한 점을 억지로 만들지 않고 추정재고 범위 양끝에서 같은 발주 결론이 나오는지 확인합니다. 방향이 흔들리는 상품은 자동 Draft에서 제외합니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="대상" value={result.barcode || "-"} />
        <Metric label="상태" value={result.state} />
        <Metric label="낮은 추정재고" value={`${number.format(result.lowInventoryQuantity)}개`} />
        <Metric label="높은 추정재고" value={`${number.format(result.highInventoryQuantity)}개`} />
        <Metric label="보수적 Draft" value={`${number.format(result.conservativeDraftRecommendedQuantity)}개`} />
        <Metric label="실제 발주 write" value="0 · READ ONLY" />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${stateTone}`}>
        <span className="text-xs font-black tracking-[0.14em] text-slate-500">NO STOCKTAKE · FAIL CLOSED</span>
        <h2 className="mt-1 text-2xl font-black text-slate-950">{result.state}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">{result.message}</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">낮은 재고 시나리오</h2>
          <p className="mt-3 text-sm text-slate-600">재고 {number.format(result.lowInventoryQuantity)}개</p>
          <strong className="mt-2 block text-3xl text-slate-950">권장 {number.format(result.lowRecommendedQuantity)}개</strong>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">높은 재고 시나리오</h2>
          <p className="mt-3 text-sm text-slate-600">재고 {number.format(result.highInventoryQuantity)}개</p>
          <strong className="mt-2 block text-3xl text-slate-950">권장 {number.format(result.highRecommendedQuantity)}개</strong>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700 shadow-sm">
        <strong className="text-slate-950">운영 정책</strong>
        <br />
        양끝 모두 발주 필요이면 두 권장수량 중 더 작은 값만 Draft 후보로 사용합니다. 양끝 모두 보류이면 보류합니다. 한쪽만 발주이면 INVENTORY_SENSITIVE로 분류해 자동 Draft를 만들지 않습니다. 현재 단계에서는 실제 중국 발주·재고 write는 모두 비활성화되어 있습니다.
        <div className="mt-3 break-all text-xs text-slate-500">Decision fingerprint · {result.fingerprint}</div>
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
