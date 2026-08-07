import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadProductMasterShoplingSalesDirectCodeEvidenceStatus } from "@/lib/productMasterShoplingSalesDirectCodeEvidence";

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

export default async function DirectCodeEvidencePage() {
  const status = await loadProductMasterShoplingSalesDirectCodeEvidenceStatus();
  const report = status.report;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · READ ONLY EVIDENCE"
        title="과거 주문 optionId · 직접 위치코드 증거 스캔"
        description="과거 Shopling 상품 catalog에 old optionId가 남아 있지 않은 경우를 대비해, 동일 주문기간의 다른 주문행에서 같은 optionId와 실제 위치코드가 함께 기록된 적이 있는지 읽기 전용으로 찾습니다. 이 화면은 상품마스터 판매원장을 수정하지 않습니다."
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
              SHOPLING ORDER DIRECT CODE EVIDENCE · NO BUSINESS WRITES
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
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="완료 구간" value={`${status.completedRanges} / ${status.totalRanges}`} />
          <Metric label="진행률" value={`${status.progress}%`} />
          <Metric label="직접코드 증거행" value={status.directEvidenceRows} />
          <Metric label="안전 optionId" value={status.safeOptionIdCount} />
          <Metric
            label="저장샘플 복원후보"
            value={status.highConfidenceStoredSampleCandidates}
          />
        </div>
      </section>

      {report ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">전수 스캔 요약</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Shopling 조회행" value={report.fetchedRows} />
              <Metric label="유효 주문행" value={report.validRows} />
              <Metric label="직접 위치코드 증거행" value={report.directEvidenceRows} />
              <Metric label="관측 optionId" value={report.observedOptionIdCount} />
              <Metric label="안전 optionId" value={report.safeOptionIdCount} />
              <Metric
                label="미연결 저장샘플"
                value={report.storedUnmappedSampleCount}
              />
              <Metric
                label="고신뢰 저장샘플 후보"
                value={report.highConfidenceStoredSampleCandidates}
              />
              <Metric
                label="샘플 위치코드 충돌"
                value={report.conflictingStoredSampleManagedCodes}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">증거 안전 분류</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {report.classifications.map((item) => (
                <Metric
                  key={item.classification}
                  label={item.classification}
                  value={item.count}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <h2 className="text-lg font-black text-emerald-950">
              고신뢰 optionId → 현재 SKU 증거
            </h2>
            <p className="mt-2 text-sm leading-6 text-emerald-900">
              같은 optionId의 유효 주문행에서 직접 위치코드가 항상 하나로만 관측되고, Shopling 상품 ID도 하나이며, 그 위치코드가 현재 활성 SKU이고 현재 주문당 재고수량도 하나로 결정되는 경우만 표시합니다.
            </p>
            <div className="mt-4 overflow-x-auto rounded-xl border border-emerald-200 bg-white">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-emerald-50 text-emerald-900">
                  <tr>
                    <th className="px-3 py-2">optionId</th>
                    <th className="px-3 py-2">Shopling 상품 ID</th>
                    <th className="px-3 py-2">위치코드</th>
                    <th className="px-3 py-2">현재 SKU</th>
                    <th className="px-3 py-2">주문당 재고수량</th>
                    <th className="px-3 py-2">직접 관측행</th>
                    <th className="px-3 py-2">관측기간</th>
                  </tr>
                </thead>
                <tbody>
                  {report.safeOptions.slice(0, 50).map((option) => (
                    <tr key={option.optionId} className="border-t border-emerald-100">
                      <td className="px-3 py-2 font-mono font-semibold">{option.optionId}</td>
                      <td className="px-3 py-2 font-mono">{option.productId}</td>
                      <td className="px-3 py-2 font-mono font-semibold">{option.barcode}</td>
                      <td className="px-3 py-2 font-mono">{option.skuId}</td>
                      <td className="px-3 py-2 font-semibold">{number.format(option.unitsPerOrder)}개</td>
                      <td className="px-3 py-2">{number.format(option.observedRows)}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {option.firstSeenAt?.slice(0, 10) ?? "-"} ~ {option.lastSeenAt?.slice(0, 10) ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        이 스캔은 Shopling 주문을 다시 읽지만 Product Master 판매원장·재고·가격·발주에는 쓰지 않습니다. 안전 optionId가 발견되어도 즉시 연결하지 않고, 다음 단계에서 동일한 증거 규칙으로 전체 주문을 다시 그림자 계산해 accepted 증가량과 unmapped 감소량이 정확히 일치하는지 검증합니다.
      </section>
    </div>
  );
}
