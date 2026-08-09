import { PageHeader } from "@/components/PageHeader";
import { loadPurchaseCandidateShoplingIdentityAudit } from "@/lib/stage8PurchaseCandidateShoplingIdentityAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function PurchaseCandidateShoplingIdentityAuditPage() {
  const report = await loadPurchaseCandidateShoplingIdentityAudit();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · SHOPLING IDENTITY AUDIT"
        title="발주후보 Shopling 식별자 교차점검"
        description="42개 발주후보의 B-code를 현재 활성 Shopling goods_key·optionId 전체 집합과 읽기 전용으로 연결합니다. 한 B-code에 여러 판매그룹/listing이 있어 goods_key가 여러 개인 것은 정상이며, 이 전체 집합을 과거 가격/모델 자료와 대조합니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="발주후보" value={number.format(report.purchaseCandidateCount)} />
        <Metric label="식별 집합 준비" value={number.format(report.identitySetReadyCount)} />
        <Metric label="활성 listing 없음" value={number.format(report.noActiveListingCount)} />
        <Metric label="복수 goods_key" value={number.format(report.multiGoodsKeyCount)} />
        <Metric label="고유 goods_key" value={number.format(report.uniqueGoodsKeyCount)} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY_READ_ONLY" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">GOODS_KEY IDENTITY SET · READ ONLY</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">BUSINESS WRITE 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-2 text-xs font-bold text-emerald-900">MULTI GOODS_KEY IS NORMAL LISTING SCOPE · NOT IDENTITY AMBIGUITY</p>
        <p className="mt-2 break-all text-xs text-slate-500">Fingerprint · {report.fingerprint}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1500px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-3 py-2">B-code</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2">현재 modelNo</th>
                <th className="px-3 py-2">기존 EXACT 복구</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">권장수량</th>
                <th className="px-3 py-2">활성 goods_key 집합</th>
                <th className="px-3 py-2">활성 optionId 집합</th>
                <th className="px-3 py-2">listing 상세</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.barcode} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono font-black text-slate-950">{row.barcode}</td>
                  <td className="px-3 py-2"><strong>{row.productName}</strong><br /><span className="text-slate-400">{row.recoveryState}</span></td>
                  <td className="px-3 py-2 font-mono">{row.currentModelNo ?? "-"}</td>
                  <td className="px-3 py-2 font-mono font-black">{row.recoveredExactModelNo ?? "-"}</td>
                  <td className="px-3 py-2 font-black">{row.state}</td>
                  <td className="px-3 py-2">{number.format(row.recommendedQty)}</td>
                  <td className="px-3 py-2 font-mono">{row.goodsKeys.length ? row.goodsKeys.join(" / ") : "-"}</td>
                  <td className="px-3 py-2 font-mono">{row.optionIds.length ? row.optionIds.join(" / ") : "-"}</td>
                  <td className="px-3 py-2">
                    {row.listings.length
                      ? row.listings.map((listing) => `${listing.goodsKey}:${listing.optionId ?? "base"}:x${listing.unitsPerOrder}:${listing.active ? "ON" : "OFF"}`).join(" | ")
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>중요: goods_key 집합 연결 ≠ aaa 모델번호 확정</strong><br />
        다음 단계에서 과거 Shopling 가격/모델 자료의 동일 goods_key들이 하나의 aaa 모델번호로 일관되게 모이는지 확인합니다. 복수 goods_key 자체는 정상입니다. 실제 차단조건은 서로 다른 aaa 모델번호 충돌, 옵션구성 불일치, 과거 자료 미존재입니다. 정확한 교차증거가 있는 행만 기존 EXACT 복구 증거에 추가할 수 있으며 재고승격·중국발주·샵플링 가격변경은 모두 OFF입니다.
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
