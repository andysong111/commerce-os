import { PageHeader } from "@/components/PageHeader";
import { loadShoplingReceiptPriceReadiness } from "@/lib/stage8ShoplingReceiptPriceReadiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function ShoplingReceiptPriceReadinessPage() {
  const report = await loadShoplingReceiptPriceReadiness();
  const changed = report.listingPlans.filter((row) => row.priceChangeRequired);
  const affectedPlans = report.goodsKeyPlans.filter(
    (row) => row.receiptTriggeredListingCount > 0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · RECEIPT-AFFECTED LIVE PRICE"
        title="샵플링 현재 판매가 → 확정입고 재가격 준비도"
        description="전체 카탈로그를 반복 조회하지 않습니다. 기존 가격판정 이후 새 확정입고가 생긴 B-code만 먼저 찾고, 그 상품의 goods_key·옵션 현재 판매가를 Shopling API에서 즉시 다시 읽은 뒤 입고원가·보호원가로 재가격합니다. 실제 가격변경은 아직 차단합니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="전체 가격 입력" value={number.format(report.inputCount)} />
        <Metric label="새 입고 영향 SKU" value={number.format(report.affectedInputCount)} />
        <Metric label="영향 B-code" value={number.format(report.affectedBarcodeCount)} />
        <Metric label="조회 goods_key" value={number.format(report.queriedGoodsKeyCount)} />
        <Metric label="실제 가격 write" value="0 · READ ONLY" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Shopling 가격 READY" value={number.format(report.livePriceReadyCount)} />
        <Metric label="영향 가격 누락" value={number.format(report.livePriceMissingCount)} />
        <Metric label="영향 가격 충돌" value={number.format(report.livePriceConflictCount)} />
        <Metric label="Planning 누락" value={number.format(report.affectedPlanningMissingCount)} />
        <Metric label="가격변경 필요" value={number.format(report.priceChangeListingCount)} />
        <Metric label="자동적용 후보" value={number.format(report.eligibleGoodsKeyCount)} />
      </section>

      <section
        className={`rounded-2xl border p-5 shadow-sm ${
          report.state === "READY"
            ? "border-emerald-200 bg-emerald-50"
            : report.state === "PARTIAL"
              ? "border-amber-200 bg-amber-50"
              : "border-rose-200 bg-rose-50"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.14em] text-slate-500">
              LIVE SOURCE OF TRUTH · RECEIPT-AFFECTED ONLY
            </span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">
              SHOPLING CURRENT SALE PRICE
            </h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">
            {report.shoplingLookupSkipped
              ? "새 입고 없음 · 조회 생략"
              : "새 입고 SKU만 LIVE 조회"}
          </strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <div className="mt-4 grid gap-2 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-3">
          <Info label="현재가 소스" value={report.currentPriceSource} />
          <Info label="조회모드" value={report.shoplingLookupMode} />
          <Info label="입고원가 소스" value={report.receiptCostSource} />
          <Info label="가격 규칙" value={report.priceRuleVersion} />
          <Info
            label="영향 Planning"
            value={`${number.format(report.affectedPlanningProductCount)}개 · goods_key ${number.format(report.affectedGoodsKeyCount)}개`}
          />
          <Info label="판정 지문" value={report.fingerprint} breakAll />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">
              새 확정입고 후 가격변경 후보
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              현재 Shopling 판매가는 그대로 판매합니다. 새 입고가 기존 가격판정 이후 들어온 B-code만 LIVE 현재가를 다시 읽고, 새 입고원가와 보호원가로 목표가격을 계산합니다.
            </p>
          </div>
          <span className="text-xs font-bold text-slate-500">
            {number.format(changed.length)}개 옵션행
          </span>
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
              </tr>
            </thead>
            <tbody>
              {changed.map((row) => (
                <tr
                  key={`${row.barcode}:${row.goodsKey}:${row.optionId}`}
                  className="border-t border-slate-100 align-top"
                >
                  <td className="px-3 py-2 font-mono font-black">{row.barcode}</td>
                  <td className="px-3 py-2">
                    <strong>{row.productName}</strong>
                    <br />
                    <span className="text-slate-400">{row.optionName ?? "-"}</span>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {row.goodsKey}
                    <br />
                    <span className="text-slate-400">{row.optionId || "단품"}</span>
                  </td>
                  <td className="px-3 py-2">{row.productGroup || "-"}</td>
                  <td className="px-3 py-2 font-black">
                    {number.format(row.currentSalePrice)}원
                  </td>
                  <td className="px-3 py-2">
                    {number.format(row.productMasterCurrentPrice)}원
                    {row.livePriceDiffersFromProductMaster ? (
                      <>
                        <br />
                        <span className="font-bold text-amber-700">LIVE 우선</span>
                      </>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{row.latestReceiptAt ?? "-"}</td>
                  <td className="px-3 py-2">
                    {number.format(row.latestReceiptCostKrw)}원
                  </td>
                  <td className="px-3 py-2">
                    {number.format(row.protectionCostKrw)}원
                  </td>
                  <td className="px-3 py-2">
                    {number.format(row.marginFloorPrice)}원
                  </td>
                  <td className="px-3 py-2">{row.grade}</td>
                  <td className="px-3 py-2 font-bold">{row.decision}</td>
                  <td className="px-3 py-2 font-black">
                    {number.format(row.recommendedPrice)}원
                  </td>
                  <td className="px-3 py-2">
                    {(row.adjustmentBps / 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
              {!changed.length ? (
                <tr>
                  <td
                    colSpan={14}
                    className="px-3 py-10 text-center font-bold text-emerald-700"
                  >
                    현재 새 확정입고로 인해 변경할 가격 후보가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">
          영향 goods_key 단위 자동적용 안전성
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          같은 goods_key가 여러 B-code에 연결돼 있으면 그 모든 활성 소유자가 이번 새 입고 대상이고 가격계획에 포함돼 있어야 합니다. 입고 비대상 B-code와 공유하거나 옵션별 조정률이 다르면 자동 적용을 금지합니다.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1550px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-3 py-2">goods_key</th>
                <th className="px-3 py-2">그룹</th>
                <th className="px-3 py-2">가격계획 B-code</th>
                <th className="px-3 py-2">활성 소유 B-code</th>
                <th className="px-3 py-2">옵션행</th>
                <th className="px-3 py-2">가격변경</th>
                <th className="px-3 py-2">조정률</th>
                <th className="px-3 py-2">자동적용 후보</th>
                <th className="px-3 py-2">차단사유</th>
              </tr>
            </thead>
            <tbody>
              {affectedPlans.map((row) => (
                <tr key={row.goodsKey} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono font-black">{row.goodsKey}</td>
                  <td className="px-3 py-2">{row.productGroup || "-"}</td>
                  <td className="px-3 py-2">{row.barcodes.join(", ")}</td>
                  <td className="px-3 py-2">{row.ownerBarcodes.join(", ") || "-"}</td>
                  <td className="px-3 py-2">{number.format(row.listingCount)}</td>
                  <td className="px-3 py-2">
                    {number.format(row.priceChangeListingCount)}
                  </td>
                  <td className="px-3 py-2">
                    {row.adjustmentBps === null
                      ? "-"
                      : `${(row.adjustmentBps / 100).toFixed(2)}%`}
                  </td>
                  <td
                    className={`px-3 py-2 font-black ${
                      row.automaticApplyEligible
                        ? "text-emerald-700"
                        : "text-slate-500"
                    }`}
                  >
                    {row.automaticApplyEligible ? "ELIGIBLE" : "BLOCKED/HOLD"}
                  </td>
                  <td className="px-3 py-2">{row.blockedReason ?? "-"}</td>
                </tr>
              ))}
              {!affectedPlans.length ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-10 text-center font-bold text-slate-500"
                  >
                    현재 새 확정입고 영향 goods_key가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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

function Info({
  label,
  value,
  breakAll = false,
}: {
  label: string;
  value: string;
  breakAll?: boolean;
}) {
  return (
    <div className={`rounded-xl bg-white/70 p-3 ${breakAll ? "break-all" : ""}`}>
      <strong>{label}</strong>
      <br />
      {value}
    </div>
  );
}
