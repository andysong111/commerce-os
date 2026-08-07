import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadProductMasterShoplingSalesUnmappedDiagnostic } from "@/lib/productMasterShoplingSalesUnmappedDiagnostic";

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

export default async function ShoplingSalesUnmappedDiagnosticPage() {
  const report = await loadProductMasterShoplingSalesUnmappedDiagnostic();
  const displayedSamples = [...report.safeSamples]
    .sort((left, right) => {
      const leftBlocker = left.category.includes("CURRENT_") || left.category === "MISSING_IDENTIFIERS";
      const rightBlocker = right.category.includes("CURRENT_") || right.category === "MISSING_IDENTIFIERS";
      if (leftBlocker !== rightBlocker) return leftBlocker ? -1 : 1;
      return (left.orderedAt ?? "").localeCompare(right.orderedAt ?? "");
    })
    .slice(0, 50);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · READ ONLY"
        title="Shopling 미연결 주문 안전 분류"
        description="현재 진행 중인 24개월 판매원장의 불변 실행원장에 이미 저장된 미연결 샘플만 읽어 분류합니다. Shopling을 다시 호출하지 않고 주문번호·구매자정보도 표시하지 않습니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/product-master/shopling-sales-backfill"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              24개월 판매원장
            </Link>
            <Link
              href="/product-master"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              상품마스터 구축현황
            </Link>
          </div>
        }
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          EXISTING LEDGER EVIDENCE ONLY · NO SOURCE READS · NO WRITES
        </p>
        <h2 className="mt-2 text-xl font-black text-slate-950">현재 분류 요약</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
          <Metric label="완료 구간" value={report.completedChunkRows} />
          <Metric label="Shopling 조회행" value={report.fetchedRows} />
          <Metric label="연결 주문" value={report.acceptedRows} />
          <Metric label="미연결 전체" value={report.totalUnmappedRows} />
          <Metric label="저장된 분류 샘플" value={report.sampledUnmappedRows} />
          <Metric label="샘플 커버리지" value={`${report.sampleCoverage}%`} />
          <Metric label="샘플 잘린 구간" value={report.truncatedChunkCount} />
          <Metric
            label="저장샘플 완전성"
            value={report.storedSamplesExhausted ? "완전" : "부분"}
          />
        </div>
        {report.truncatedChunkCount > 0 ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            일부 기간 구간은 실제 미연결 주문 수가 실행원장에 보존된 안전 샘플 수보다 많습니다. 따라서 아래 비율은 <strong>저장된 샘플 분포</strong>이며 전체 1,000여 건을 전수분류했다고 해석하면 안 됩니다.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">미연결 유형</h2>
        <div className="mt-4 space-y-3">
          {report.categories.length ? (
            report.categories.map((item) => (
              <article
                key={item.category}
                className={`rounded-xl border p-4 ${
                  item.risk === "BLOCKER"
                    ? "border-rose-200 bg-rose-50"
                    : "border-amber-200 bg-amber-50"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="max-w-4xl">
                    <code className="text-sm font-black text-slate-950">
                      {item.category}
                    </code>
                    <p className="mt-1 text-sm leading-6 text-slate-700">
                      {item.meaning}
                    </p>
                  </div>
                  <div className="text-right">
                    <strong className="block text-xl text-slate-950">
                      {number.format(item.sampleCount)}건
                    </strong>
                    <span className="text-xs font-semibold text-slate-600">
                      저장샘플 {item.shareOfSamples}% · {item.risk}
                    </span>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-slate-500">분류할 미연결 샘플이 없습니다.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">현재 SKU 관련 위험 샘플 우선 보기</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          주문번호·구매자·금액은 노출하지 않습니다. 현재 Product Master 식별자와 교집합이 있는 blocker를 먼저 보여주고, 해당 goods_key·optionId 아래 현재 후보 SKU와 판매환산수량을 함께 표시합니다.
        </p>
        <div className="mt-4 space-y-3">
          {displayedSamples.length ? (
            displayedSamples.map((sample, index) => (
              <article
                key={`${sample.category}-${sample.orderedAt ?? "none"}-${index}`}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
                  <code className="font-black text-slate-950">{sample.category}</code>
                  <span>주문시각 {sample.orderedAt ?? "-"}</span>
                  <span>위치코드 {sample.managedCode ?? "-"}</span>
                  <span>옵션 ID {sample.optionId ?? "-"}</span>
                  <span>상품 ID {sample.productId ?? "-"}</span>
                  <span>몰 상품키 {sample.mallProductKey ?? "-"}</span>
                  <span>상태 {sample.status ?? "-"}</span>
                </div>
                {sample.currentCandidates.length ? (
                  <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2">현재 후보 위치코드</th>
                          <th className="px-3 py-2">상품/옵션</th>
                          <th className="px-3 py-2">현재 optionId</th>
                          <th className="px-3 py-2">goods_key</th>
                          <th className="px-3 py-2">주문당 재고수량</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sample.currentCandidates.map((candidate) => (
                          <tr
                            key={`${candidate.skuId}-${candidate.optionId ?? "none"}-${candidate.goodsKey ?? "none"}`}
                            className="border-t border-slate-100"
                          >
                            <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                              {candidate.barcode}
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              {candidate.productName}
                              {candidate.optionName ? ` · ${candidate.optionName}` : ""}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-700">
                              {candidate.optionId ?? "-"}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-700">
                              {candidate.goodsKey ?? "-"}
                            </td>
                            <td className="px-3 py-2 font-semibold text-slate-900">
                              {number.format(candidate.unitsPerOrder)}개
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <p className="text-sm text-slate-500">표시할 안전 샘플이 없습니다.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
        이 화면은 기존 실행원장과 현재 Product Master planning snapshot만 읽습니다. Shopling 재조회 0회, Product Master/Shopling 쓰기 0회입니다. 분류 결과만으로 자동 제외하지 않고 현재 SKU 누락 가능성을 먼저 제거합니다.
      </section>
    </div>
  );
}
