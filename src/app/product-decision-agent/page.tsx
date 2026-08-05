import Link from "next/link";
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
  if (status === "보류" || status === "발주 보류") {
    return "border-slate-200 bg-slate-100 text-slate-700";
  }
  return "border-slate-200 bg-white text-slate-700";
}

export default async function ProductDecisionAgentPage() {
  const {
    snapshot,
    error,
    sourceHost,
    sourceMode,
    writesEnabled,
    liveOverlay,
  } = await loadProductDecisionSnapshot();
  const products = (snapshot.products ?? []).slice(0, 500);
  const recommendedCount = products.filter(
    (product) => product.status === "발주 추천",
  ).length;
  const reviewCount = products.filter(
    (product) => product.status === "소량 검토",
  ).length;
  const internalSnapshot = sourceMode !== "legacy_site";
  const liveMode = sourceMode === "internal_live_overlay";
  const overlayWarning =
    liveOverlay.inventoryError || liveOverlay.commitmentError;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 발주 추천 내부 이전"
        title="발주 추천"
        description="검증된 판매 수요 목표에 상품마스터 최신 확인재고와 중국 주문 중 남은 미입고 수량을 덧씌워 신규 필요량을 갱신합니다. 승인·중국 주문 전송·실제 주문은 계속 차단합니다."
        actions={
          <Link
            href="/product-decision-agent/migration"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            검증 백업 복원
          </Link>
        }
      />

      <section
        className={`rounded-2xl border p-5 text-sm ${
          liveMode
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : internalSnapshot
              ? "border-blue-200 bg-blue-50 text-blue-950"
              : "border-amber-200 bg-amber-50 text-amber-950"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-base">
              {liveMode
                ? "라이브 재고·미입고 오버레이 연결"
                : internalSnapshot
                  ? "Ops Center 검증 발주안 복원"
                  : "기존 발주 추천 읽기 전용 연결"}
            </strong>
            <p className="mt-1 leading-6">
              {liveMode
                ? "판매 수요 목표는 검증 기준을 유지하고, 추정재고·진행발주·확보수량·신규필요는 현재 운영 원장으로 다시 계산합니다."
                : internalSnapshot
                  ? "검증된 D1 발주안을 Ops Center 운영 원장에서 읽습니다. 최신 재고 연결 상태는 아래에서 확인합니다."
                  : "Ops Center 서버가 기존 발주 추천 결과를 읽기만 합니다."}
            </p>
          </div>
          <span className="inline-flex rounded-full border border-current/20 bg-white px-3 py-1 text-xs font-black">
            {writesEnabled ? "쓰기 허용" : "실제 주문 쓰기 차단"}
          </span>
        </div>
        <p className="mt-3 text-xs opacity-75">현재 원본: {sourceHost}</p>
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          <strong className="block text-base">
            발주 추천 데이터를 불러오지 못했습니다.
          </strong>
          <p className="mt-2 break-words">{error}</p>
          <Link
            href="/product-decision-agent/migration"
            className="mt-4 inline-flex rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white hover:bg-rose-800"
          >
            검증 백업 복원 화면 열기
          </Link>
        </section>
      ) : null}

      {overlayWarning ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <strong className="block text-base">
            일부 라이브 원장을 연결하지 못했습니다.
          </strong>
          {liveOverlay.inventoryError ? (
            <p className="mt-2 break-words">
              상품마스터 재고: {liveOverlay.inventoryError}
            </p>
          ) : null}
          {liveOverlay.commitmentError ? (
            <p className="mt-2 break-words">
              중국 미입고 원장: {liveOverlay.commitmentError}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-amber-800">
            연결되지 않은 항목은 0개로 임의 추정하지 않고 미확인 상태로 둡니다.
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          [
            "계산 상태",
            text(snapshot.mode, "준비 중"),
            text(snapshot.runStatus, "상태 없음"),
          ],
          [
            "전체 상품",
            number.format(products.length),
            "위치코드형 발주 대상",
          ],
          [
            "발주 추천(기준)",
            number.format(recommendedCount),
            "검증 기준 판매 발주안",
          ],
          [
            "소량 검토(기준)",
            number.format(reviewCount),
            "MOQ·예산 기준값",
          ],
          [
            "예상 발주금액(기준)",
            won.format(nonnegative(snapshot.expectedSpend)),
            "라이브 예산 재배분 전",
          ],
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

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <OverlayMetric
          label="확인재고 연결"
          value={liveOverlay.confirmedInventoryCount}
          note="상품마스터 확정 재고"
        />
        <OverlayMetric
          label="미입고 바코드"
          value={liveOverlay.commitmentBarcodeCount}
          note="중국 주문 잔량 보유"
        />
        <OverlayMetric
          label="신규필요 갱신"
          value={liveOverlay.changedProductCount}
          note="기준 수량과 달라진 상품"
        />
        <OverlayMetric
          label="신규필요 0"
          value={liveOverlay.zeroNeedCount}
          note="현재 확보수량으로 충족"
          emphasized
        />
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">재고 기준시각</p>
          <strong className="mt-2 block break-words text-base font-black text-slate-950">
            {liveOverlay.inventoryGeneratedAt
              ? new Date(liveOverlay.inventoryGeneratedAt).toLocaleString(
                  "ko-KR",
                )
              : "미확인"}
          </strong>
          <p className="mt-2 text-xs text-slate-500">
            Product Master 스냅샷
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">
              발주 수요 목표와 라이브 확보수량
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {text(snapshot.generatedAt, "생성 시각 없음")} ·{" "}
              {text(snapshot.periodLabel, "최신 계산")}
            </p>
          </div>
          <div className="max-w-2xl text-right text-xs text-slate-500">
            <p>기준 예산 {won.format(nonnegative(snapshot.budget))}</p>
            <p className="mt-1">
              권장주문·예상금액은 아직 검증 기준값입니다. 최신 판매 수집 후
              MOQ·박스입수·예산을 포함해 전체 재계산합니다.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1180px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">상품</th>
                <th className="px-3 py-3">기준 판정</th>
                <th className="px-3 py-3 text-right">예상판매</th>
                <th className="px-3 py-3 text-right">수요목표</th>
                <th className="px-3 py-3 text-right">현재 확인재고</th>
                <th className="px-3 py-3 text-right">중국 미입고</th>
                <th className="px-3 py-3 text-right">라이브 신규필요</th>
                <th className="px-3 py-3 text-right">권장주문(기준)</th>
                <th className="px-3 py-3 text-right">예상금액(기준)</th>
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
                      {product.inventoryKnown
                        ? number.format(nonnegative(product.estimatedStock))
                        : "미확인"}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-700">
                      {number.format(nonnegative(product.openCommitment))}
                    </td>
                    <td
                      className={`px-3 py-4 text-right font-black ${
                        nonnegative(product.netRequiredRaw) === 0
                          ? "text-emerald-700"
                          : "text-blue-700"
                      }`}
                    >
                      {number.format(nonnegative(product.netRequiredRaw))}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-700">
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
                  <td
                    colSpan={10}
                    className="px-3 py-10 text-center text-slate-500"
                  >
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

function OverlayMetric({
  label,
  value,
  note,
  emphasized = false,
}: {
  label: string;
  value: number;
  note: string;
  emphasized?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        emphasized ? "border-emerald-200" : "border-slate-200"
      }`}
    >
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <strong
        className={`mt-2 block text-2xl font-black ${
          emphasized ? "text-emerald-700" : "text-slate-950"
        }`}
      >
        {number.format(value)}
      </strong>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </article>
  );
}
