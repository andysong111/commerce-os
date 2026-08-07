import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadProductMasterShoplingSalesHistoricalShadowStatus } from "@/lib/productMasterShoplingSalesHistoricalShadow";

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

export default async function HistoricalOptionShadowPage() {
  const status = await loadProductMasterShoplingSalesHistoricalShadowStatus();
  const report = status.report;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · READ ONLY SHADOW"
        title="과거 Shopling 옵션 판매원장 그림자 검증"
        description="현재 판매원장을 건드리지 않고 과거 Shopling optionId→당시 위치코드 증거를 이용해 동일 주문범위를 다시 계산합니다. 현재 resolver가 먼저 적용되며 고신뢰 과거 증거는 현재 resolver가 실패한 주문에만 fallback으로 사용됩니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/product-master/shopling-sales-backfill"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              24개월 판매원장
            </Link>
            <Link
              href="/product-master/shopling-sales-backfill/unmapped-diagnostic/catalog-evidence"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              과거 Catalog 증거
            </Link>
          </div>
        }
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              HISTORICAL OPTION SHADOW · NO BUSINESS WRITES
            </p>
            <h2 className="mt-2 text-xl font-black text-slate-950">현재 상태</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              {status.message}
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">
            {status.state}
          </span>
        </div>
        <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600"
            style={{ width: `${Math.min(100, status.progress)}%` }}
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="완료 구간" value={`${status.completedRanges} / ${status.totalRanges}`} />
          <Metric label="진행률" value={`${status.progress}%`} />
          <Metric label="추가 연결 관측" value={status.fallbackResolvedRows} />
          <Metric label="단계" value={status.stage} />
        </div>
      </section>

      {report ? (
        <>
          <section
            className={`rounded-2xl border p-5 shadow-sm ${
              report.safeToPromote
                ? "border-emerald-200 bg-emerald-50"
                : "border-rose-200 bg-rose-50"
            }`}
          >
            <p className="text-xs font-black uppercase tracking-[0.16em]">
              PROMOTION GATE
            </p>
            <h2 className="mt-2 text-xl font-black">
              {report.safeToPromote
                ? "그림자 resolver 검증 통과"
                : "그림자 resolver 운영 반영 차단"}
            </h2>
            <p className="mt-2 text-sm leading-6">{report.promotionReason}</p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">기존 원장 vs 그림자 재계산</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="기존 연결 주문" value={report.baseline.acceptedRows} />
              <Metric label="그림자 연결 주문" value={report.shadow.acceptedRows} />
              <Metric label="기존 미연결" value={report.baseline.unmappedRows} />
              <Metric label="그림자 미연결" value={report.shadow.unmappedRows} />
              <Metric label="fallback 해결" value={report.shadow.fallbackResolvedRows} />
              <Metric label="fallback 기본재고수량" value={report.shadow.fallbackBaseUnits} />
              <Metric label="fallback 매출" value={`${number.format(report.shadow.fallbackRevenue)}원`} />
              <Metric
                label="직접 위치코드 충돌 차단"
                value={report.shadow.fallbackRejectedDirectCodeConflict}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">안정 구간 교차검증</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              기준 수집 종료일이 포함된 마지막 구간은 주문 상태가 바뀔 수 있어 promotion 판단에서 제외합니다. 나머지 구간에서 조회행·제외행·중복행이 동일한지와 accepted 증가량 = unmapped 감소량 = fallback 해결량인지 비교합니다.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="안정 구간" value={report.stableComparison.stableRangeCount} />
              <Metric label="변동 제외 구간" value={report.stableComparison.volatileRangeCount} />
              <Metric
                label="원천 형태 일치"
                value={report.stableComparison.sourceShapeMatch ? "일치" : "불일치"}
              />
              <Metric
                label="증감식 일치"
                value={report.stableComparison.deltaConsistent ? "일치" : "불일치"}
              />
              <Metric label="accepted 증가" value={report.stableComparison.acceptedDelta} />
              <Metric label="unmapped 감소" value={report.stableComparison.unmappedDelta} />
              <Metric
                label="fallback 해결"
                value={report.stableComparison.fallbackResolvedRows}
              />
              <Metric
                label="goods_key 불일치 차단"
                value={report.shadow.fallbackRejectedGoodsKeyMismatch}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Resolver 안전조건</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Catalog 옵션" value={report.resolverStats.catalogOptionCount} />
              <Metric label="안전 optionId" value={report.resolverStats.safeOptionCount} />
              <Metric
                label="과거 위치코드 모호"
                value={report.resolverStats.ambiguousHistoricalBarcodeCount}
              />
              <Metric label="현재 없는 과거 SKU" value={report.resolverStats.legacyBarcodeCount} />
              <Metric
                label="현재 환산수량 모호"
                value={report.resolverStats.ambiguousCurrentUnitsCount}
              />
              <Metric
                label="현재 listing 없음"
                value={report.resolverStats.noCurrentListingCount}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">추가 연결 안전 샘플</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              주문번호·구매자정보는 표시하지 않습니다. optionId·goods_key 교집합·과거 위치코드·현재 환산수량이 모두 일치해 그림자 계산에서 추가 연결된 건만 최대 30개 보여줍니다.
            </p>
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2">주문시각</th>
                    <th className="px-3 py-2">optionId</th>
                    <th className="px-3 py-2">상품 ID</th>
                    <th className="px-3 py-2">과거 위치코드</th>
                    <th className="px-3 py-2">주문수량</th>
                    <th className="px-3 py-2">환산수량</th>
                    <th className="px-3 py-2">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {report.fallbackSamples.slice(0, 30).map((sample, index) => (
                    <tr
                      key={`${sample.optionId}-${sample.orderedAt}-${index}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-2 text-slate-600">{sample.orderedAt}</td>
                      <td className="px-3 py-2 font-mono text-slate-800">{sample.optionId}</td>
                      <td className="px-3 py-2 font-mono text-slate-800">{sample.productId ?? "-"}</td>
                      <td className="px-3 py-2 font-mono font-semibold text-slate-900">{sample.barcode}</td>
                      <td className="px-3 py-2">{sample.orderQuantity}</td>
                      <td className="px-3 py-2 font-semibold">{sample.baseUnits}</td>
                      <td className="px-3 py-2 text-slate-600">{sample.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
        이 검증은 Shopling 주문을 다시 읽지만 Product Master 판매원장·가격·발주·재고에는 쓰지 않습니다. 결과가 통과해도 자동 promotion하지 않으며, 후속 단계에서 운영 resolver 코드에 동일 안전조건을 옮긴 뒤 다시 CI·카나리를 거칩니다.
      </section>
    </div>
  );
}
