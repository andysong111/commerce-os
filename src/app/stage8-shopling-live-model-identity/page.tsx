import { PageHeader } from "@/components/PageHeader";
import { loadShoplingLiveModelIdentityAudit } from "@/lib/stage8ShoplingLiveModelIdentityAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const number = new Intl.NumberFormat("ko-KR");

export default async function ShoplingLiveModelIdentityAuditPage() {
  const report = await loadShoplingLiveModelIdentityAudit();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · SHOPLING LIVE MODEL IDENTITY"
        title="Shopling 실시간 model_no · model_nm 교차검증"
        description="샵플링 상품조회 API가 제공하는 model_no·model_nm을 현재 42개 발주후보의 활성 goods_key만 실시간 조회합니다. 현재 Shopling 자체에 남아 있는 원본 모델번호를 읽는 단계이며 어떤 상품·가격·재고도 수정하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="발주후보" value={number.format(report.purchaseCandidateCount)} />
        <Metric label="조회 goods_key" value={number.format(report.queriedGoodsKeyCount)} />
        <Metric label="exact aaa goods_key" value={number.format(report.exactAaaGoodsKeyCount)} />
        <Metric label="단일모델 완전집합" value={number.format(report.exactSingleModelSetCount)} />
        <Metric label="복수모델 완전집합" value={number.format(report.exactMultiModelSetCount)} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="부분 model 증거" value={number.format(report.partialModelEvidenceCount)} />
        <Metric label="goods_key 내부충돌" value={number.format(report.goodsKeyModelConflictCount)} />
        <Metric label="exact aaa 없음" value={number.format(report.noExactAaaModelCount)} />
        <Metric label="기존 EXACT 포함" value={number.format(report.priorIncludedCount)} />
        <Metric label="기존 EXACT 충돌" value={number.format(report.priorConflictCount)} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY_READ_ONLY" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">SHOPLING PRODUCT QUERY · MODEL_NO / MODEL_NM · READ ONLY</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">SHOPLING WRITE 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-2 text-xs text-slate-500">Source rows · {number.format(report.sourceRowCount)}</p>
        <p className="mt-1 break-all text-xs text-slate-500">Fingerprint · {report.fingerprint}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1800px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-3 py-2">B-code</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2">판정</th>
                <th className="px-3 py-2">Shopling exact model_no</th>
                <th className="px-3 py-2">model_nm</th>
                <th className="px-3 py-2">goods_key</th>
                <th className="px-3 py-2">exact</th>
                <th className="px-3 py-2">non-aaa</th>
                <th className="px-3 py-2">blank</th>
                <th className="px-3 py-2">conflict</th>
                <th className="px-3 py-2">missing</th>
                <th className="px-3 py-2">기존 복구</th>
                <th className="px-3 py-2">기존대조</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.barcode} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono font-black text-slate-950">{row.barcode}</td>
                  <td className="px-3 py-2 font-bold">{row.productName}</td>
                  <td className="px-3 py-2 font-black">{row.state}</td>
                  <td className="px-3 py-2 font-mono font-black">{row.exactModelNos.join(" / ") || "-"}</td>
                  <td className="px-3 py-2">{row.modelNames.join(" / ") || "-"}</td>
                  <td className="px-3 py-2 font-mono">{row.goodsKeys.join(" / ") || "-"}</td>
                  <td className="px-3 py-2">{number.format(row.exactGoodsKeyCount)}</td>
                  <td className="px-3 py-2">{number.format(row.nonAaaGoodsKeyCount)}</td>
                  <td className="px-3 py-2">{number.format(row.blankGoodsKeyCount)}</td>
                  <td className="px-3 py-2">{number.format(row.conflictGoodsKeyCount)}</td>
                  <td className="px-3 py-2">{number.format(row.missingGoodsKeyCount)}</td>
                  <td className="px-3 py-2 font-mono">{row.priorRecoveredModelNo ?? "-"}</td>
                  <td className="px-3 py-2 font-black">{row.priorComparison}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>Shopling model_no를 읽었다고 즉시 과거 발주이력을 합치지 않습니다.</strong><br />
        모든 현재 goods_key가 같은 exact aaa 모델을 반환하면 강한 현재 증거가 되지만, 과거 상품구성이 변경되었을 가능성까지 자동으로 지우지는 않습니다. 복수 aaa 모델은 실제 멀티모델 구성으로 그대로 보존하고, blank·non-aaa·충돌·누락은 차단합니다. 모델복구·과거발주 연결·재고승격·실제 발주·가격변경은 모두 OFF입니다.
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
