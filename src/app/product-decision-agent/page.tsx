import { PageHeader } from "@/components/PageHeader";
import { loadProductDecisionSnapshot } from "@/lib/integrations/productDecisionAgent";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");
const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

function text(value: string | null | undefined, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function nonnegative(value: number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function statusTone(status: string | null | undefined) {
  if (status === "발주 추천") {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  if (status === "소량 검토") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "보류") {
    return "border-slate-200 bg-slate-100 text-slate-700";
  }
  return "border-slate-200 bg-white text-slate-700";
}

export default async function ProductDecisionAgentPage() {
  const { snapshot, error, sourceHost, writesEnabled } =
    await loadProductDecisionSnapshot();
  const products = (snapshot.products ?? []).slice(0, 500);
  const recommendedCount = products.filter(
    (product) => product.status === "발주 추천",
  ).length;
  const reviewCount = products.filter(
    (product) => product.status === "소량 검토",
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 내부 이전 1단계"
        title="발주 추천"
        description="기존 발주 추천 엔진의 최신 계산 결과를 Ops Center 안에서 조회합니다. 현재는 그림자 운영 단계이며 승인·중국 주문 전송·실제 주문 기능은 모두 차단되어 있습니다."
      />

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-base">Ops Center 내부 조회 전환 완료</strong>
            <p className="mt-1 leading-6">
              데이터 원본은 아직 기존 발주 추천 엔진이며, Ops Center 서버가 읽기 전용으로 가져옵니다.
            </p>
          </div>
          <span className="inline-flex rounded-full border border-blue-300 bg-white px-3 py-1 text-xs font-black text-blue-800">
            {writesEnabled ? "쓰기 허용" : "쓰기 차단"}
          </span>
        </div>
        <p className="mt-3 text-xs text-blue-700">현재 원본: {sourceHost}</p>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          <strong className="block text-base">발주 추천 데이터를 불러오지 못했습니다.</strong>
          <p className="mt-2 break-words">{error}</p>
          <p className="mt-2 text-xs leading-5 text-rose-700">
            기존 발주 추천 Site에는 영향을 주지 않았습니다. 연결 환경변수 또는 기존 Site 상태만 확인하면 됩니다.
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["계산 상태", text(snapshot.mode, "준비 중"), text(snapshot.runStatus, "상태 없음")],
          ["전체 상품", number.format(products.length), "위치코드형 발주 대상"],
          ["발주 추천", number.format(recommendedCount), "신규 주문 필요"],
          ["소량 검토", number.format(reviewCount), "MOQ·예산 확인"],
          ["예상 발주금액", won.format(nonnegative(snapshot.expectedSpend)), "현재 계산 결과 합계"],
        ].map(([label, value, note]) => (
          <article
            key={String(label)}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm font-semibold text-slate-500">{label}</p>
            <strong className="mt-2 block break-words text-2xl font-black text-slate-950">
              {value}
            </strong>
            <p className="mt-2 text-xs text-slate-500">{note}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">최신 발주 계산 결과</h2>
            <p className="mt-1 text-sm text-slate-500">
              {text(snapshot.generatedAt, "생성 시각 없음")} · {text(snapshot.periodLabel, "최신 계산")}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>예산 {won.format(nonnegative(snapshot.budget))}</p>
            <p className="mt-1 max-w-xl">{text(snapshot.budgetBasis, "예산 기준 없음")}</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1180px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">상품</th>
                <th className="px-3 py-3">판정</th>
                <th className="px-3 py-3 text-right">예상판매</th>
                <th className="px-3 py-3 text-right">수요목표</th>
                <th className="px-3 py-3 text-right">추정재고</th>
                <th className="px-3 py-3 text-right">진행발주</th>
                <th className="px-3 py-3 text-right">신규필요</th>
                <th className="px-3 py-3 text-right">권장주문</th>
                <th className="px-3 py-3 text-right">예상금액</th>
                <th className="px-3 py-3 text-right">점수</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.length ? (
                products.map((product, index) => (
                  <tr key={`${text(product.barcode, "unknown")}-${index}`}>
                    <td className="px-3 py-4">
                      <strong className="block max-w-xs text-slate-950">
                        {text(product.name, "상품명 없음")}
                      </strong>
                      <span className="mt-1 block font-mono text-xs text-slate-500">
                        {text(product.barcode)}
                        {product.modelNo ? ` · ${product.modelNo}` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(product.status)}`}
                      >
                        {text(product.status, "판단 대기")}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {text(product.trend, "추이 없음")}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-700">
                      {number.format(nonnegative(product.forecastUnits))}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-700">
                      {number.format(nonnegative(product.rawRecommendedQty))}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-700">
                      {product.inventoryKnown === false
                        ? "미확인"
                        : number.format(nonnegative(product.estimatedStock))}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-700">
                      {number.format(nonnegative(product.openCommitment))}
                    </td>
                    <td className="px-3 py-4 text-right font-bold text-slate-950">
                      {number.format(nonnegative(product.netRequiredRaw))}
                    </td>
                    <td className="px-3 py-4 text-right font-black text-blue-700">
                      {number.format(nonnegative(product.recommendedQty))}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-700">
                      {won.format(nonnegative(product.expectedCost))}
                    </td>
                    <td className="px-3 py-4 text-right font-black text-slate-950">
                      {number.format(nonnegative(product.score?.total))}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-slate-500">
                    표시할 최신 발주 추천 결과가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
