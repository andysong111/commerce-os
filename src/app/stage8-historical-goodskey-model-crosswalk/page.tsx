import { PageHeader } from "@/components/PageHeader";
import { loadHistoricalGoodsKeyModelCrosswalk } from "@/lib/stage8HistoricalGoodsKeyModelCrosswalk";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function HistoricalGoodsKeyModelCrosswalkPage() {
  const report = await loadHistoricalGoodsKeyModelCrosswalk();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · HISTORICAL GOODS_KEY MODEL CROSSWALK"
        title="과거 goods_key ↔ aaa 모델번호 교차검증"
        description="현재 42개 발주후보의 전체 Shopling goods_key 집합을 과거 가격·모델 검증자료의 원본 모델번호와 대조합니다. 일부 listing만 증거가 있거나 한 B-code가 여러 aaa 모델로 구성되면 그대로 구분하고, 하나의 모델로 억지 통합하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="발주후보" value={number.format(report.purchaseCandidateCount)} />
        <Metric label="단일모델 완전증거" value={number.format(report.singleModelFullCoverageCount)} />
        <Metric label="복수모델 완전증거" value={number.format(report.multiModelFullCoverageCount)} />
        <Metric label="부분증거" value={number.format(report.partialCoverageCount)} />
        <Metric label="증거없음" value={number.format(report.noEvidenceCount)} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="정확 증거행" value={number.format(report.evidenceRecordCount)} />
        <Metric label="증거 goods_key" value={number.format(report.evidenceGoodsKeyCount)} />
        <Metric label="모델 충돌" value={number.format(report.modelConflictCount)} />
        <Metric label="활성 listing 없음" value={number.format(report.noActiveListingCount)} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY_READ_ONLY" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">ORIGINAL MODEL EVIDENCE · READ ONLY</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">INVENTORY / PURCHASE WRITE 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-2 break-all text-xs text-slate-500">Fingerprint · {report.fingerprint}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1700px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-3 py-2">B-code</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2">판정</th>
                <th className="px-3 py-2">증거율</th>
                <th className="px-3 py-2">원본 aaa 모델</th>
                <th className="px-3 py-2">가격용 교차모델</th>
                <th className="px-3 py-2">현재 goods_key</th>
                <th className="px-3 py-2">증거 goods_key</th>
                <th className="px-3 py-2">미확인 goods_key</th>
                <th className="px-3 py-2">근거</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.barcode} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono font-black text-slate-950">{row.barcode}</td>
                  <td className="px-3 py-2 font-bold">{row.productName}</td>
                  <td className="px-3 py-2 font-black">{row.state}</td>
                  <td className="px-3 py-2">{row.coveragePct.toFixed(2)}%</td>
                  <td className="px-3 py-2 font-mono font-black">{row.originalModelNos.length ? row.originalModelNos.join(" / ") : "-"}</td>
                  <td className="px-3 py-2 font-mono">{row.pricingCrossMatchModelNos.length ? row.pricingCrossMatchModelNos.join(" / ") : "-"}</td>
                  <td className="px-3 py-2 font-mono">{row.currentGoodsKeys.join(" / ") || "-"}</td>
                  <td className="px-3 py-2 font-mono text-emerald-700">{row.evidencedGoodsKeys.join(" / ") || "-"}</td>
                  <td className="px-3 py-2 font-mono text-rose-700">{row.uncoveredGoodsKeys.join(" / ") || "-"}</td>
                  <td className="px-3 py-2">
                    {row.evidence.length
                      ? row.evidence.map((evidence) => `${evidence.goodsKey}=${evidence.originalModelNo} · ${evidence.sourceArtifact}/${evidence.sourceSheet}`).join(" | ")
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>이 결과는 과거 발주수량을 재고로 만드는 승인이 아닙니다.</strong><br />
        `SINGLE_MODEL_FULL_COVERAGE`도 다음 단계의 과거 중국 발주이력 연결 후보일 뿐입니다. `MULTI_MODEL_FULL_COVERAGE`는 한 B-code 안에 서로 다른 aaa 모델/구성이 실제로 섞여 있다는 뜻이므로 모델별 수량·세트 환산 규칙이 증명되기 전에는 합산하지 않습니다. `PARTIAL_COVERAGE`와 `NO_EVIDENCE`는 계속 차단합니다. 가격용 교차모델은 원본 Shopling 모델번호와 분리 보존합니다.
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
