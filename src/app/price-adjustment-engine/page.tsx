import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadPriceAdjustmentDashboard } from "@/lib/integrations/priceAdjustmentEngine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");
const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

function decisionLabel(value: string) {
  if (value === "increase_required") return "인상 필요";
  if (value === "decrease_review") return "인하 검토";
  if (value === "discontinued_review") return "단종 정리";
  if (value === "blocked") return "확인 필요";
  return "가격 유지";
}

function decisionTone(value: string) {
  if (value === "increase_required") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (value === "decrease_review" || value === "discontinued_review") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (value === "blocked") {
    return "border-slate-300 bg-slate-100 text-slate-700";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function gradeLabel(value: number | null) {
  if (value === null) return "미연결";
  if (value > 0) return `+${value}`;
  return String(value);
}

function gradeTone(value: number | null) {
  if (value === null) return "bg-slate-100 text-slate-600";
  if (value > 0) return "bg-rose-100 text-rose-700";
  if (value <= -3) return "bg-amber-100 text-amber-800";
  if (value < 0) return "bg-slate-100 text-slate-700";
  return "bg-emerald-100 text-emerald-700";
}

export default async function PriceAdjustmentEnginePage() {
  const { dashboard, sourceMode, sourceHost, writesEnabled, error } =
    await loadPriceAdjustmentDashboard();
  const rows = dashboard.recommendations.slice(0, 500);
  const lifecycleMode = sourceMode === "product_master_lifecycle";
  const shadowCount = rows.filter((row) => row.shadowMode).length;
  const reorderBlockedCount = rows.filter(
    (row) => row.reorderingAllowed === false,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 상품등급·가격조정 내부 이전"
        title="상품등급·가격조정"
        description="Product Master 안정 SKU에 저장된 +6~-4 상품등급, 자동 시즌, 보호가격, 재고정리·재발주 가능 상태를 Ops Center에서 조회합니다. 실제 가격변경은 기존 안전 실행기를 통해서만 진행합니다."
        actions={
          <Link
            href="/shopling-price-adjustment-runner"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            가격 실행기 열기
          </Link>
        }
      />

      <section
        className={`rounded-2xl border p-5 text-sm ${
          lifecycleMode
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : "border-blue-200 bg-blue-50 text-blue-950"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-base">
              {lifecycleMode
                ? "Product Master 안정 SKU 상품등급 원장 연결"
                : "Ops Center 내부 조회 진입점"}
            </strong>
            <p className="mt-1 leading-6">
              {lifecycleMode
                ? "바코드가 변경돼도 같은 안정 SKU에 등급과 이력이 이어집니다. 그림자 모드에서는 미래 가격·단종 상태만 표시하고 실제 반영하지 않습니다."
                : `현재 원본은 ${sourceHost}이며 계산 결과와 운영원장을 읽기만 합니다.`}
            </p>
          </div>
          <span className="rounded-full border border-current/20 bg-white px-3 py-1 text-xs font-black">
            {writesEnabled ? "쓰기 허용" : "실제 가격변경 차단"}
          </span>
        </div>
        <p className="mt-3 text-xs opacity-75">
          데이터 모드: {sourceMode} · 원본: {sourceHost}
        </p>
      </section>

      {error ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <strong>가격조정 데이터 연결 안내</strong>
          <p className="mt-2 break-words">{error}</p>
          <p className="mt-2 text-xs">
            기존 가격변경 실행기와 운영 데이터에는 영향이 없습니다.
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="인상 필요"
          value={dashboard.summary.increaseRequired}
          note="양의 등급·마진 복구"
        />
        <Metric
          label="인하 검토"
          value={dashboard.summary.decreaseReview}
          note="-3 장기감소 확인"
        />
        <Metric
          label="단종 정리"
          value={dashboard.summary.discontinuedReview}
          note="-4 재고정리 후보"
        />
        <Metric
          label="그림자 등급"
          value={shadowCount}
          note="실제 가격 미반영"
        />
        <Metric
          label="재발주 제한"
          value={reorderBlockedCount}
          note="상품 수명주기 상태"
          danger={reorderBlockedCount > 0 && shadowCount === 0}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">
              최신 상품등급·목표가격
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {dashboard.notice}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>상태 {dashboard.run?.status || dashboard.mode}</p>
            <p className="mt-1">
              {dashboard.run?.generatedAt || "생성 이력 없음"}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1450px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">상품</th>
                <th className="px-3 py-3">등급·시즌</th>
                <th className="px-3 py-3">판정</th>
                <th className="px-3 py-3 text-right">기준가</th>
                <th className="px-3 py-3 text-right">목표가</th>
                <th className="px-3 py-3 text-right">보호가격</th>
                <th className="px-3 py-3">재발주</th>
                <th className="px-3 py-3">근거</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length ? (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-4">
                      <strong className="block max-w-sm text-slate-950">
                        {row.name}
                      </strong>
                      <span className="mt-1 block font-mono text-xs text-slate-500">
                        {row.barcode || "바코드 없음"}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex min-w-10 justify-center rounded-full px-2.5 py-1 text-xs font-black ${gradeTone(row.grade)}`}
                      >
                        {gradeLabel(row.grade)}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {row.seasonality || "계절성 미연결"}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${decisionTone(row.decision)}`}
                      >
                        {decisionLabel(row.decision)}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {row.shadowMode ? "그림자" : `위험 ${row.risk}`}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-right font-semibold">
                      {won.format(row.currentPrice)}
                    </td>
                    <td className="px-3 py-4 text-right font-black text-blue-700">
                      {won.format(row.recommendedPrice)}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold">
                      {won.format(
                        row.protectionFloor || row.protectionCost * 2,
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                          row.reorderingAllowed === false
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {row.reorderingAllowed === false
                          ? row.shadowMode
                            ? "향후 제한"
                            : "제한"
                          : "허용"}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {row.lifecycleStatus || "상태 미연결"}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-xs leading-5 text-slate-600">
                      {row.reasons.slice(0, 3).join(" · ") || "근거 없음"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-10 text-center text-slate-500"
                  >
                    표시할 상품등급 결과가 없습니다. 상품마스터 등급 원장과
                    가격판정 입력을 연결하고 있습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">
          자체 가격엔진 연결 단계
        </h2>
        <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
          <p className="rounded-xl bg-emerald-50 p-4">
            완료: 최근 365일 최근 입고 3회 최고원가 보호 규칙 코드 이식
          </p>
          <p className="rounded-xl bg-emerald-50 p-4">
            완료: 자동 시즌과 +6~-4 등급 계산 코드 이식
          </p>
          <p className="rounded-xl bg-blue-50 p-4">
            진행: 상품마스터 등급 원장과 Ops Center 대시보드 연결
          </p>
          <p className="rounded-xl bg-slate-50 p-4">
            다음: 동일 판매·입고 입력으로 자체 엔진 그림자 재계산 후 안전
            실행기로 전달
          </p>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  danger = false,
}: {
  label: string;
  value: number;
  note: string;
  danger?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        danger ? "border-rose-200" : "border-slate-200"
      }`}
    >
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <strong
        className={`mt-2 block text-2xl font-black ${
          danger ? "text-rose-700" : "text-slate-950"
        }`}
      >
        {number.format(value)}
      </strong>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </article>
  );
}
