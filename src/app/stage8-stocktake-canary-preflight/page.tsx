import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadStocktakeCanaryPreflight } from "@/lib/stage8StocktakeCanaryPreflight";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function StocktakeCanaryPreflightPage() {
  let report: Awaited<ReturnType<typeof loadStocktakeCanaryPreflight>> | null = null;
  let error: string | null = null;
  try {
    report = await loadStocktakeCanaryPreflight();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "STOCKTAKE canary 사전검증을 읽지 못했습니다.";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · STOCKTAKE CANARY PREFLIGHT"
        title="재고실사 1건 canary 사전검증"
        description="최소 실사 계획의 첫 B-code를 Product Master 현재 재고 guard와 다시 대조합니다. 안전조건을 모두 만족할 때만 실제 창고 수량 1개를 요청하며, 이 화면에서는 STOCKTAKE와 발주 write를 절대 실행하지 않습니다."
        actions={
          <Link
            href="/stage8-stocktake-intervention-plan"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            최소 실사 계획
          </Link>
        }
      />

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">
          {error}
        </p>
      ) : report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="상태" value={report.state} good={report.state === "READY_FOR_PHYSICAL_COUNT"} />
            <Metric label="Canary B-code" value={report.barcode ?? "-"} />
            <Metric label="PM 재고상태" value={report.inventoryVerification ?? "-"} />
            <Metric label="PM 기준점" value={report.inventoryBaselineKind ?? "-"} />
            <Metric label="PM write gate" value={report.productMasterWriteEnabled ? "ON" : "OFF"} />
            <Metric label="실제 write" value="0 · READ ONLY" />
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="text-lg font-black text-emerald-950">
              {report.state === "READY_FOR_PHYSICAL_COUNT"
                ? "이제 사람에게 필요한 것은 실제 수량 1개뿐입니다"
                : "아직 사람에게 수량을 요청하지 않습니다"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-emerald-900">{report.message}</p>
            {report.state === "READY_FOR_PHYSICAL_COUNT" ? (
              <div className="mt-4 rounded-xl border border-emerald-300 bg-white p-4">
                <div className="text-xs font-black tracking-[0.12em] text-emerald-700">CANARY COUNT TARGET</div>
                <div className="mt-2 text-2xl font-black text-slate-950">{report.barcode}</div>
                <div className="mt-1 text-sm font-semibold text-slate-700">{report.name}</div>
                <div className="mt-1 text-xs text-slate-500">{report.modelNo ?? "-"}</div>
                <div className="mt-4 text-sm font-black text-slate-950">입력할 값: 현재 창고에 실제로 있는 개수</div>
              </div>
            ) : null}
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="현재 PM 표시수량" value={report.inventoryQuantity ?? 0} />
            <Metric label="PM Canary eligible" value={String(report.productMasterCanaryEligible)} />
            <Metric label="STOCKTAKE write" value={String(report.stocktakeWritesEnabled)} />
            <Metric label="PURCHASE write" value={String(report.purchaseWritesEnabled)} />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">고정된 안전 증거</h2>
            <div className="mt-3 space-y-2 break-all font-mono text-xs text-slate-500">
              <p>Plan fingerprint · {report.planFingerprint}</p>
              <p>Inventory guard · {report.inventoryGuard ?? "-"}</p>
              <p>Product Master skuId · {report.productMasterSkuId ?? "-"}</p>
              <p>Requested field · {report.requestedOperatorInput ?? "NONE"}</p>
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
}: {
  label: string;
  value: string | number;
  good?: boolean;
}) {
  return (
    <article className={`rounded-xl border p-4 ${good ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">
        {typeof value === "number" ? number.format(value) : value}
      </strong>
    </article>
  );
}
