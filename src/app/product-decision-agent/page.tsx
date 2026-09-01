import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadProductDecisionSnapshot } from "@/lib/integrations/productDecisionAgent";
import {
  loadProductDecisionMonthlyArchive,
  type ProductDecisionMonthlyArchive,
  type ProductDecisionMonthOption,
} from "@/lib/productDecisionMonthlyArchive";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");
const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});
const cny = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
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

export default async function ProductDecisionAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const archive = await loadProductDecisionMonthlyArchive(params.month).catch(
    () => null,
  );

  if (archive?.readOnly) {
    return <ArchivedPurchaseMonth archive={archive} />;
  }

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
  const currentMonth = archive?.selected ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 월별 발주 추천"
        title="발주 추천"
        description="월별 발주 사이클을 분리해 봅니다. 현재 월은 발주 계산·검토가 가능한 운영 화면이고, 마감된 과거 월은 당시 확정 발주 항목을 그대로 보존한 읽기 전용 원장입니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/product-decision-agent/live-refresh"
              className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-800"
            >
              월간 발주안 계산
            </Link>
            <Link
              href="/product-decision-agent/migration"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              검증 백업 복원
            </Link>
          </div>
        }
      />

      {archive ? <MonthCycleNavigation archive={archive} /> : null}

      {currentMonth && !currentMonth.monthlyRunCreated ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <strong className="block text-base">
                {currentMonth.label} 월간 발주안은 아직 생성되지 않았습니다.
              </strong>
              <p className="mt-2 max-w-5xl leading-6">
                아래의 `발주 추천(기준)`과 예상 발주금액은 현재 월의 새 확정 권장안이 아니라,
                기존 검증 스냅샷에 최신 확인재고·중국 미입고를 덧씌워 참고하는 기준 화면입니다.
                이번 달 발주 결정은 `월간 발주안 계산`에서 새 사이클을 생성한 뒤 확정합니다.
              </p>
            </div>
            <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-black">
              현재 월 · 계산 전
            </span>
          </div>
        </section>
      ) : null}

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
            "검증 기준 스냅샷",
          ],
          [
            "소량 검토(기준)",
            number.format(reviewCount),
            "MOQ·예산 기준값",
          ],
          [
            "예상 발주금액(기준)",
            won.format(nonnegative(snapshot.expectedSpend)),
            "현재 월 확정안 아님",
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
              기준 스냅샷 {text(snapshot.generatedAt, "생성 시각 없음")} ·{" "}
              {text(snapshot.periodLabel, "최신 계산")}
            </p>
          </div>
          <div className="max-w-2xl text-right text-xs text-slate-500">
            <p>기준 예산 {won.format(nonnegative(snapshot.budget))}</p>
            <p className="mt-1">
              이 표는 현재 월 신규 계산 전에도 기준 스냅샷을 보여줍니다. 실제 월간 발주안은
              직전 달 정상매출 예산·최신 판매·확인재고·중국 미입고·MOQ를 다시 반영해 생성합니다.
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

function MonthCycleNavigation({
  archive,
}: {
  archive: ProductDecisionMonthlyArchive;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-slate-500">
            MONTHLY PURCHASE CYCLES
          </span>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            월별 발주 사이클
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            월을 눌러 당시 발주 항목을 확인합니다. 마감된 월은 당시 원장만 표시하고
            최신 재고나 판매 데이터로 다시 계산하지 않습니다.
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">
          최근 {archive.months.length}개 월
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {archive.months.map((month) => (
          <MonthLink
            key={month.cycleMonth}
            month={month}
            selected={month.cycleMonth === archive.selectedCycleMonth}
          />
        ))}
      </div>
    </section>
  );
}

function MonthLink({
  month,
  selected,
}: {
  month: ProductDecisionMonthOption;
  selected: boolean;
}) {
  const stateLabel =
    month.state === "CURRENT"
      ? month.monthlyRunCreated
        ? "진행중 · 계산 생성"
        : "진행중 · 계산 전"
      : month.state === "CLOSED"
        ? "마감 · 읽기 전용"
        : "과거 기록 · 읽기 전용";
  const tone = selected
    ? "border-slate-950 bg-slate-950 text-white"
    : month.state === "CLOSED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-400"
      : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-400";
  return (
    <Link
      href={`/product-decision-agent?month=${month.cycleMonth}`}
      className={`rounded-xl border px-4 py-3 transition-colors ${tone}`}
    >
      <strong className="block text-sm">{month.label}</strong>
      <span className={`mt-1 block text-[11px] font-bold ${selected ? "text-slate-300" : "opacity-75"}`}>
        {stateLabel}
      </span>
    </Link>
  );
}

function ArchivedPurchaseMonth({
  archive,
}: {
  archive: ProductDecisionMonthlyArchive;
}) {
  const closed = archive.selected.state === "CLOSED";
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 월별 발주 추천"
        title={`${archive.selected.label} 발주 사이클`}
        description="과거 사이클은 마감 당시 확정된 발주 항목을 그대로 보여주는 읽기 전용 원장입니다. 현재 재고·판매·미입고 데이터를 덧씌우거나 과거 수량을 다시 계산하지 않습니다."
        actions={
          <Link
            href={`/product-decision-agent?month=${archive.currentCycleMonth}`}
            className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
          >
            현재 월로 돌아가기
          </Link>
        }
      />

      <MonthCycleNavigation archive={archive} />

      <section
        className={`rounded-2xl border p-5 shadow-sm ${
          closed
            ? "border-emerald-300 bg-emerald-50 text-emerald-950"
            : "border-slate-300 bg-slate-50 text-slate-900"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <strong className="block text-lg">
              {closed ? "사이클 마감 완료" : "과거 사이클 기록"}
            </strong>
            <p className="mt-2 text-sm leading-6">
              이 화면은 읽기 전용입니다. 과거 발주수량·중국 주문정보는 수정할 수 없으며,
              현재 월 데이터가 바뀌어도 이 월의 기록은 변하지 않습니다.
            </p>
          </div>
          <span className="rounded-full border border-current/20 bg-white px-3 py-1 text-xs font-black">
            {closed ? "마감 · READ ONLY" : "과거 · READ ONLY"}
          </span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <ArchiveMetric label="사이클" value={archive.selected.label} />
        <ArchiveMetric
          label="상태"
          value={closed ? "마감" : "과거 기록"}
          emphasized={closed}
        />
        <ArchiveMetric
          label="확정 발주 SKU"
          value={`${number.format(archive.lineCount)}개`}
        />
        <ArchiveMetric
          label="확정 발주수량"
          value={`${number.format(archive.totalQuantity)}개`}
        />
        <ArchiveMetric
          label="마감시각"
          value={
            archive.closedAt
              ? new Date(archive.closedAt).toLocaleString("ko-KR")
              : "마감 원장 없음"
          }
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">
              마감 확정 발주 항목
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {archive.savedAt
                ? `발주 원장 저장 ${new Date(archive.savedAt).toLocaleString("ko-KR")}`
                : "저장된 발주 원장이 없습니다."}
              {archive.draftId ? ` · ${archive.draftId}` : ""}
            </p>
          </div>
          <strong className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
            읽기 전용
          </strong>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1050px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
              <tr>
                <th className="px-3 py-3">B-code</th>
                <th className="px-3 py-3">상품 · 모델</th>
                <th className="px-3 py-3">판매옵션</th>
                <th className="px-3 py-3 text-right">확정 발주수량</th>
                <th className="px-3 py-3 text-right">1688 단가</th>
                <th className="px-3 py-3 text-right">중국내운임</th>
                <th className="px-3 py-3">1688 주문번호</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {archive.lines.length ? (
                archive.lines.map((line, index) => (
                  <tr key={`${line.barcode}-${index}`}>
                    <td className="px-3 py-4 font-mono font-black text-slate-950">
                      {line.barcode}
                    </td>
                    <td className="px-3 py-4">
                      <strong className="block max-w-sm text-slate-950">
                        {line.modelName || line.productName || "상품명 없음"}
                      </strong>
                      <span className="mt-1 block font-mono text-xs text-slate-500">
                        {line.modelNo || "모델번호 없음"}
                      </span>
                    </td>
                    <td className="px-3 py-4 font-semibold text-slate-700">
                      {line.saleOption || "-"}
                    </td>
                    <td className="px-3 py-4 text-right text-base font-black text-blue-700">
                      {number.format(line.quantity)}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-700">
                      ¥{cny.format(line.unitPriceCny)}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-700">
                      ¥{cny.format(line.domesticChinaFreightCny)}
                    </td>
                    <td className="px-3 py-4 font-mono text-xs text-slate-600">
                      {line.orderNumber || "-"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                    이 월에 보존된 확정 발주 항목이 없습니다.
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

function ArchiveMetric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        emphasized ? "border-emerald-300" : "border-slate-200"
      }`}
    >
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <strong
        className={`mt-2 block break-words text-xl font-black ${
          emphasized ? "text-emerald-800" : "text-slate-950"
        }`}
      >
        {value}
      </strong>
    </article>
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
