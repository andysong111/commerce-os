import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadProductMasterShoplingSalesCatalogEvidence } from "@/lib/productMasterShoplingSalesCatalogEvidence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-lg text-slate-950">
        {typeof value === "number" ? number.format(value) : value}
      </strong>
    </article>
  );
}

export default async function ShoplingSalesCatalogEvidencePage() {
  const report = await loadProductMasterShoplingSalesCatalogEvidence();
  const highConfidence = report.samples
    .filter((sample) => sample.autoResolveCandidate)
    .slice(0, 50);
  const unresolved = report.samples
    .filter((sample) => !sample.autoResolveCandidate)
    .slice(0, 30);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · IMMUTABLE CATALOG EVIDENCE"
        title="미연결 주문 · 과거 Shopling 상품증거 대조"
        description="새 Shopling 호출 없이 이전 24개월 상품·옵션 전수진단에 이미 저장된 optionId·goods_key·위치코드 증거와 미연결 주문을 대조합니다. 정확한 과거 optionId가 현재 위치코드까지 이어지고 주문당 재고수량도 하나로 결정되는 경우만 고신뢰 후보로 표시합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/product-master/shopling-sales-backfill/unmapped-diagnostic"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              미연결 주문 분류
            </Link>
            <Link
              href="/product-master/shopling-sales-backfill"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              24개월 판매원장
            </Link>
          </div>
        }
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          NO NEW SHOPLING READS · NO BUSINESS WRITES
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="상품진단 구간" value={report.catalogChunkCount} />
          <Metric label="과거 옵션 증거" value={report.catalogOptionCount} />
          <Metric label="미연결 저장샘플" value={report.unmappedStoredSampleCount} />
          <Metric
            label="고신뢰 자동해결 후보"
            value={report.highConfidenceAutoResolveSamples}
          />
          <Metric
            label="자동해결 후보 비율"
            value={
              report.unmappedStoredSampleCount
                ? `${Math.round(
                    (report.highConfidenceAutoResolveSamples /
                      report.unmappedStoredSampleCount) *
                      10_000,
                  ) / 100}%`
                : "0%"
            }
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">증거 분류</h2>
        <div className="mt-4 space-y-3">
          {report.classifications.map((item) => (
            <article
              key={item.classification}
              className={`rounded-xl border p-4 ${
                item.autoResolveCandidate
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <code className="text-sm font-black text-slate-950">
                  {item.classification}
                </code>
                <div className="text-right">
                  <strong className="block text-lg text-slate-950">
                    {number.format(item.count)}건
                  </strong>
                  <span className="text-xs font-semibold text-slate-600">
                    저장샘플 {item.share}%
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-lg font-black text-emerald-950">
          고신뢰 후보 — 아직 진단만
        </h2>
        <p className="mt-2 text-sm leading-6 text-emerald-900">
          아래 항목은 과거 주문 optionId가 상품 전수진단에서 단 하나의 위치코드로 이어지고, 그 위치코드의 현재 활성 listing도 동일한 주문당 재고수량 하나만 갖는 경우입니다. 현재 단계에서는 판매원장을 다시 계산하거나 저장하지 않습니다.
        </p>
        <div className="mt-4 space-y-3">
          {highConfidence.length ? (
            highConfidence.map((sample, index) => (
              <article
                key={`${sample.order.optionId ?? "none"}-${sample.order.orderedAt ?? "none"}-${index}`}
                className="rounded-xl border border-emerald-200 bg-white p-4"
              >
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-700">
                  <span>주문시각 {sample.order.orderedAt ?? "-"}</span>
                  <span>주문 optionId {sample.order.optionId ?? "-"}</span>
                  <span>주문 goods_key {sample.order.productId ?? "-"}</span>
                  <span>기존 분류 {sample.priorCategory}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-emerald-900">
                  {sample.reason}
                </p>
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">과거 위치코드</th>
                        <th className="px-3 py-2">과거 상품/옵션</th>
                        <th className="px-3 py-2">현재 SKU</th>
                        <th className="px-3 py-2">주문당 재고수량</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sample.matches.map((match, matchIndex) => (
                        <tr
                          key={`${match.optionId}-${match.barcode}-${matchIndex}`}
                          className="border-t border-slate-100"
                        >
                          <td className="px-3 py-2 font-mono font-semibold">
                            {match.barcode || "-"}
                          </td>
                          <td className="px-3 py-2">
                            {match.productName || "-"}
                            {match.optionName ? ` · ${match.optionName}` : ""}
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {match.currentSkuId ?? "-"}
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            {match.uniqueCurrentUnitsPerOrder
                              ? `${number.format(match.uniqueCurrentUnitsPerOrder)}개`
                              : "모호"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-emerald-900">
              현재 저장샘플에서는 고신뢰 자동해결 후보가 확인되지 않았습니다.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">아직 자동연결할 수 없는 증거</h2>
        <div className="mt-4 space-y-2">
          {unresolved.map((sample, index) => (
            <article
              key={`${sample.classification}-${sample.order.optionId ?? "none"}-${index}`}
              className="rounded-xl border border-slate-200 p-3 text-xs"
            >
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <code className="font-black text-slate-900">
                  {sample.classification}
                </code>
                <span>optionId {sample.order.optionId ?? "-"}</span>
                <span>goods_key {sample.order.productId ?? "-"}</span>
                <span>위치코드 {sample.order.managedCode ?? "-"}</span>
                <span>증거 {sample.matches.length}개</span>
              </div>
              <p className="mt-1 text-slate-600">{sample.reason}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        이 화면은 자동 제외·자동 매핑을 실행하지 않습니다. 다음 단계는 오직 `CATALOG_EXACT_OPTION_CURRENT_BARCODE_SAFE_UNITS`만 순수 resolver 후보로 넣어 기존 결과와 그림자 비교한 뒤, 미연결 감소량과 오연결 차단조건을 검증하는 것입니다.
      </section>
    </div>
  );
}
