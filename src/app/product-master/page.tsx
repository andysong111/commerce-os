import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import {
  loadProductMasterCatalogReadiness,
  productMasterCatalogReadinessConfigured,
  type ProductMasterCatalogIssue,
  type ProductMasterCatalogReadiness,
} from "@/lib/productMasterCatalogReadiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

function phaseLabel(phase: string) {
  if (phase === "CATALOG_BLOCKED") return "기준정보 충돌 해결 필요";
  if (phase === "CATALOG_REVIEW") return "연결·환산수량 검토 필요";
  return "Shopling 매출 적재 준비 완료";
}

function phaseTone(phase: string) {
  if (phase === "CATALOG_BLOCKED") {
    return "border-rose-200 bg-rose-50 text-rose-950";
  }
  if (phase === "CATALOG_REVIEW") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-950";
}

export default async function ProductMasterPage() {
  const configured = productMasterCatalogReadinessConfigured();
  let report: ProductMasterCatalogReadiness | null = null;
  let error: string | null = null;
  if (configured) {
    try {
      report = await loadProductMasterCatalogReadiness();
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : "상품마스터 구축현황을 불러오지 못했습니다.";
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 기준정보"
        title="상품마스터"
        description="바코드별 상품·옵션·Shopling 연결·세트 환산수량을 먼저 완성한 뒤 판매원장과 발주·가격 기능을 연결합니다."
        actions={
          <a
            href="https://commerce-os-product-master.vercel.app/"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
          >
            전체 상품마스터 열기
          </a>
        }
      />

      {!configured ? (
        <StatusBox
          title="Product Master 연동 설정 필요"
          message="Ops Center Production의 Product Master 연동 비밀값을 설정해야 구축현황을 확인할 수 있습니다."
          tone="border-amber-200 bg-amber-50 text-amber-950"
        />
      ) : error ? (
        <StatusBox
          title="상품마스터 구축현황 조회 실패"
          message={error}
          tone="border-rose-200 bg-rose-50 text-rose-950"
        />
      ) : report ? (
        <ProductMasterReadinessView report={report} />
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
            1단계
          </span>
          <h2 className="mt-4 text-lg font-black text-slate-950">
            상품·SKU 기준정보
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            내부 SKU ID, 현재 바코드, 모델번호, 모델명, 옵션명과 과거 바코드 이력을 보존합니다.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
            2단계
          </span>
          <h2 className="mt-4 text-lg font-black text-slate-950">
            Shopling 판매옵션 연결
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            goods_key·옵션 ID를 한 내부 SKU에만 연결하고 1+1·N개입의 판매 1건당 실제 재고수량을 저장합니다.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
            재고 시작 원칙
          </span>
          <h2 className="mt-4 text-lg font-black text-slate-950">
            0개·미확인으로 시작
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            초기 0은 실제 품절로 보지 않습니다. 실사 또는 실제 품절 0 확인 이후부터만 확정재고로 누적합니다.
          </p>
        </article>
      </section>
    </div>
  );
}

function ProductMasterReadinessView({
  report,
}: {
  report: ProductMasterCatalogReadiness;
}) {
  const summary = report.summary;
  return (
    <>
      <section
        className={`rounded-2xl border p-5 text-sm ${phaseTone(summary.phase)}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-base">
              {phaseLabel(summary.phase)}
            </strong>
            <p className="mt-2 leading-6">{summary.nextAction}</p>
          </div>
          <span className="rounded-full border border-current/20 bg-white px-3 py-1 text-xs font-black">
            {summary.readyForShoplingSalesImport
              ? "다음 단계 가능"
              : "판매원장 적재 보류"}
          </span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="활성 SKU"
          value={summary.activeSkuCount}
          note={`전체 ${number.format(summary.totalSkuCount)}개`}
        />
        <Metric
          label="차단 문제"
          value={summary.blockerSkuCount}
          note="중복·필수정보 충돌"
          danger={summary.blockerSkuCount > 0}
        />
        <Metric
          label="검토 필요"
          value={summary.reviewSkuCount}
          note="연결·옵션·세트수량"
          warning={summary.reviewSkuCount > 0}
        />
        <Metric
          label="Shopling 연결"
          value={summary.listingMappedCount}
          note={`미연결 ${number.format(summary.listingMissingCount)}개`}
        />
        <Metric
          label="확인 재고"
          value={summary.inventoryConfirmedCount}
          note={`초기 미확인 ${number.format(summary.inventoryUnverifiedCount)}개`}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="고유 바코드"
          value={summary.uniqueBarcodeCount}
          note={`중복 그룹 ${number.format(summary.duplicateBarcodeCount)}`}
        />
        <Metric
          label="세트수량 검토"
          value={summary.suspectedSetQuantityCount}
          note="1+1·N개입 가능성"
        />
        <Metric
          label="판매이력 보유"
          value={summary.salesCoveredCount}
          note="후속 Shopling 적재 대상"
        />
        <Metric
          label="확정원가 보유"
          value={summary.costCoveredCount}
          note="입고확정 후 점진 누적"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">
              기준정보 수정 대상
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              초기재고 미확인은 의도된 시작 상태이므로 이 목록에 포함하지 않습니다.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            {new Date(report.generatedAt).toLocaleString("ko-KR")} · {number.format(report.issues.length)}개
          </p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1050px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">단계</th>
                <th className="px-3 py-3">바코드</th>
                <th className="px-3 py-3">모델·상품</th>
                <th className="px-3 py-3">옵션</th>
                <th className="px-3 py-3">문제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.issues.slice(0, 300).map((issue) => (
                <IssueRow key={issue.skuId} issue={issue} />
              ))}
              {!report.issues.length ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-10 text-center text-emerald-700"
                  >
                    상품마스터 기준정보 차단·검토 대상이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {report.issues.length > 300 ? (
          <p className="mt-3 text-xs text-slate-500">
            전체 {number.format(report.issues.length)}개 중 300개만 표시합니다. 전체 수정은 상품마스터 검토함에서 진행합니다.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="https://commerce-os-product-master.vercel.app/catalog-readiness"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            전체 구축현황 열기
          </a>
          <a
            href="https://commerce-os-product-master.vercel.app/review-queue"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            상품마스터 검토함 열기
          </a>
          <Link
            href="/operations"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            연동 이력 확인
          </Link>
        </div>
      </section>
    </>
  );
}

function IssueRow({ issue }: { issue: ProductMasterCatalogIssue }) {
  const blocker = issue.severity === "BLOCKER";
  return (
    <tr>
      <td className="px-3 py-4">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${
            blocker
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {blocker ? "차단" : "검토"}
        </span>
      </td>
      <td className="px-3 py-4 font-mono text-xs text-slate-700">
        {issue.barcode || "-"}
      </td>
      <td className="px-3 py-4">
        <strong className="block text-slate-950">
          {issue.productName || "상품명 없음"}
        </strong>
        <span className="mt-1 block text-xs text-slate-500">
          {issue.modelNo || "모델번호 없음"}
        </span>
      </td>
      <td className="px-3 py-4 text-slate-700">
        {issue.optionName || "옵션명 없음"}
      </td>
      <td className="px-3 py-4 text-xs leading-5 text-slate-600">
        {issue.messages.join(" · ")}
      </td>
    </tr>
  );
}

function Metric({
  label,
  value,
  note,
  danger = false,
  warning = false,
}: {
  label: string;
  value: number;
  note: string;
  danger?: boolean;
  warning?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        danger
          ? "border-rose-200"
          : warning
            ? "border-amber-200"
            : "border-slate-200"
      }`}
    >
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <strong
        className={`mt-2 block text-2xl font-black ${
          danger
            ? "text-rose-700"
            : warning
              ? "text-amber-700"
              : "text-slate-950"
        }`}
      >
        {number.format(value)}
      </strong>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </article>
  );
}

function StatusBox({
  title,
  message,
  tone,
}: {
  title: string;
  message: string;
  tone: string;
}) {
  return (
    <section className={`rounded-2xl border p-5 text-sm ${tone}`}>
      <strong className="block text-base">{title}</strong>
      <p className="mt-2 break-words leading-6">{message}</p>
    </section>
  );
}
