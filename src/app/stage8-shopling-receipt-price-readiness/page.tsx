import { PageHeader } from "@/components/PageHeader";
import { loadShoplingReceiptPriceReadiness } from "@/lib/stage8ShoplingReceiptPriceReadiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function ShoplingReceiptPriceReadinessPage() {
  const report = await loadShoplingReceiptPriceReadiness();
  const changed = report.listingPlans.filter((row) => row.priceChangeRequired);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · LIVE SHOPLING PRICE + RECEIPT"
        title="샵플링 현재 판매가 → 확정입고 재가격 준비도"
        description="현재 판매가는 Product Master의 과거 스냅샷을 믿지 않고 Shopling 상품조회 API에서 goods_key·옵션별로 매번 다시 읽습니다. 확정입고가 발생하면 최신 입고원가와 보호원가로 가격등급 엔진을 다시 계산하고, 같은 goods_key 내부가 안전하게 하나의 조정률로 합쳐질 때만 적용 후보로 올립니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="가격 입력 SKU" value={number.format(report.inputCount)} />
        <Metric label="샵플링 가격 READY" value={number.format(report.livePriceReadyCount)} />
        <Metric label="가격 누락" value={number.format(report.livePriceMissingCount)} />
        <Metric label="가격 충돌" value={number.format(report.livePriceConflictCount)} />
        <Metric label="실제 가격 write" value="0 · READ ONLY" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="옵션 가격계획" value={number.format(report.listingPlanCount)} />
        <Metric label="새 입고 트리거" value={number.format(report.receiptTriggeredListingCount)} />
        <Metric label="가격변경 필요" value={number.format(report.priceChangeListingCount)} />
        <Metric label="goods_key 자동적용 후보" value={number.format(report.eligibleGoodsKeyCount)} />
        <Metric label="goods_key 충돌차단" value={number.format(report.blockedGoodsKeyCount)} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY" ? "border-emerald-200 bg-emerald-50" : report.state === "PARTIAL" ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.14em] text-slate-500">LIVE SOURCE OF TRUTH</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">SHOPLING CURRENT SALE PRICE</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">입고 후 자동 재계산 · WRITE OFF</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <div className="mt-4 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
          <div className="rounded-xl bg-white/70 p-3"><strong>현재가 소스</strong><br />{report.currentPriceSource}</div>
          <div className="rounded-xl bg-white/70 p-3"><strong>입고원가 소스</strong><br />{report.receiptCostSource}</div>
          <div className="rounded-xl bg-white/70 p-3"><strong>가격 규칙</strong><br />{report.priceRuleVersion}</div>
          <div className="rounded-xl bg-white/70 p-3 break-all"><strong>판정 지문</strong><br />{report.fingerprint}</div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">새 확정입고 후 가격변경 후보</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">샵플링 실판매가를 기준으로 계산합니다. 현재가는 그대로 판매하고, 새 입고가 기존 가격판정 이후 들어온 경우에만 재가격 트리거가 켜집니다.</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{number.format(changed.length)}개 옵션행</span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1900px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-3 py-2">바코드</th>
                <th className="px-3 py-2">상품</th>
                <th className="px-3 py-2">goods_key</th>
                <th className="px-3 py-2">그룹</th>
                <th className="px-3 py-2">샵플링 현재가</th>
                <th className="px-3 py-2">PM 과거 현재가</th>
                <th className="px-3 py-2">최근 확정입고</th>
                <th className="px-3 py-2">최근원가</th>
                <th className="px-3 py-2">보호원가</th>
                <th className="px-3 py-2">마진하한</th>
                <th className="px-3 py-2">등급</th>
                <th className="px-3 py-2">판정</th>
                <th className="px-3 py-2">목표가</th>
                <th className="px-3 py-2">조정률</th>
                <th className="px-3 py-2">입고트리거</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((row) => (
                <tr key={`${row.barcode}:${row.goodsKey}:${row.optionId}`} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono font-black">{row.barcode}</td>
                  <td className="px-3 py-2"><strong>{row.productName}</strong><br /><span className="text-slate-400">{row.optionName ?? "-"}</span></td>
                  <td className="px-3 py-2 font-mono">{row.goodsKey}<br /><span className="text-slate-400">{row.optionId || "단품"}</span></td>
                  <td className="px-3 py-2">{row.productGroup || "-"}</td>
                  <td className="px-3 py-2 font-black">{number.format(row.currentSalePrice)}원</td>
                  <td className="px-3 py-2">{number.format(row.productMasterCurrentPrice)}원{row.livePriceDiffersFromProductMaster ? <><br /><span className="font-bold text-amber-700">LIVE 우선</span></> : null}</td>
                  <td className="px-3 py-2">{row.latestReceiptAt ?? "-"}</td>
                  <td className="px-3 py-2">{number.format(row.latestReceiptCostKrw)}원</td>
                  <td className="px-3 py-2">{number.format(row.protectionCostKrw)}원</td>
                  <td className="px-3 py-2">{number.format(row.marginFloorPrice)}원</td>
                  <td className="px-3 py-2">{row.grade}</td>
                  <td className="px-3 py-2 font-bold">{row.decision}</td>
                  <td className="px-3 py-2 font-black">{number.format(row.recommendedPrice)}원</td>
                  <td className="px-3 py-2">{(row.adjustmentBps / 100).toFixed(2)}%</td>
                  <td className="px-3 py-2 font-bold">{row.receiptTriggered ? "NEW RECEIPT" : "NO"}</td>
                </tr>
              ))}
              {!changed.length ? <tr><td colSpan={15} className="px-3 py-10 text-center font-bold text-emerald-700">현재 새 확정입고로 인해 변경할 가격 후보가 없습니다.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">goods_key 단위 자동적용 안전성</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">실제 샵플링 가격수정 실행기는 goods_key 단위이므로, 같은 goods_key 안의 옵션들이 서로 다른 조정률을 요구하면 자동 적용을 금지합니다.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1200px] text-left text-xs">
            <thead className="text-slate-500"><tr><th className="px-3 py-2">goods_key</th><th className="px-3 py-2">그룹</th><th className="px-3 py-2">바코드</th><th className="px-3 py-2">옵션행</th><th className="px-3 py-2">입고트리거</th><th className="px-3 py-2">가격변경</th><th className="px-3 py-2">조정률</th><th className="px-3 py-2">자동적용 후보</th><th className="px-3 py-2">차단사유</th></tr></thead>
            <tbody>{report.goodsKeyPlans.map((row) => (
              <tr key={row.goodsKey} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono font-black">{row.goodsKey}</td>
                <td className="px-3 py-2">{row.productGroup || "-"}</td>
                <td className="px-3 py-2">{row.barcodes.join(", ")}</td>
                <td className="px-3 py-2">{number.format(row.listingCount)}</td>
                <td className="px-3 py-2">{number.format(row.receiptTriggeredListingCount)}</td>
                <td className="px-3 py-2">{number.format(row.priceChangeListingCount)}</td>
                <td className="px-3 py-2">{row.adjustmentBps === null ? "-" : `${(row.adjustmentBps / 100).toFixed(2)}%`}</td>
                <td className={`px-3 py-2 font-black ${row.automaticApplyEligible ? "text-emerald-700" : "text-slate-500"}`}>{row.automaticApplyEligible ? "ELIGIBLE" : "BLOCKED/HOLD"}</td>
                <td className="px-3 py-2">{row.blockedReason ?? "-"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4"><span className="text-xs font-semibold text-slate-500">{label}</span><strong className="mt-1 block break-all text-lg text-slate-950">{value}</strong></article>;
}
