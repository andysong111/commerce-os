import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import {
  loadStage8Readiness,
  type Stage8Check,
  type Stage8ReadinessReport,
} from "@/lib/stage8Readiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8ReadinessPage() {
  let report: Stage8ReadinessReport | null = null;
  let error: string | null = null;
  try {
    report = await loadStage8Readiness();
  } catch (caught) {
    error =
      caught instanceof Error
        ? caught.message
        : "Stage 8 전환 준비상태를 불러오지 못했습니다.";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8"
        title="하위 엔진 전환 준비도"
        description="판매·재고·입고원가를 Product Master 기준으로 고정한 뒤 발주 추천과 상품등급·가격조정 엔진을 같은 canonical 입력으로 전환할 수 있는지 읽기 전용으로 확인합니다. 이 화면은 실제 가격·발주·단종을 실행하지 않습니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/product-master/inventory-cost-readiness"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              재고·원가 신뢰도
            </Link>
            <Link
              href="/price-adjustment-engine/shadow-compare"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              가격등급 그림자
            </Link>
            <Link
              href="/product-decision-agent"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              발주 추천
            </Link>
          </div>
        }
      />

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">
          {error}
        </p>
      ) : report ? (
        <ReadinessView report={report} />
      ) : null}
    </div>
  );
}

function ReadinessView({ report }: { report: Stage8ReadinessReport }) {
  const summary = report.summary;
  const price = report.priceGradePreview.summary;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric
          label="Canonical 기반"
          value={summary.canonicalFoundationReady ? "준비" : "차단"}
          tone={summary.canonicalFoundationReady ? "green" : "rose"}
        />
        <Metric
          label="관리 SKU"
          value={number.format(report.inventoryCost.summary.managedActiveSkuCount)}
        />
        <Metric
          label="확인재고"
          value={number.format(summary.inventoryVerifiedCount)}
          note={`미확인 ${number.format(summary.inventoryUnverifiedCount)}`}
          tone="amber"
        />
        <Metric
          label="확정원가"
          value={number.format(summary.receiptCostCoveredCount)}
          note={`미보유 ${number.format(summary.receiptCostMissingCount)}`}
          tone={summary.receiptCostMissingCount ? "amber" : "green"}
        />
        <Metric
          label="가격등급 조치가능"
          value={number.format(summary.priceGradeActionableInputCount)}
          note={`엔진차단 ${number.format(price.blockedCount)}`}
          tone={price.blockedCount ? "amber" : "green"}
        />
        <Metric
          label="업무 쓰기"
          value="차단"
          note="그림자 전환 단계"
          tone="slate"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">단계별 게이트</h2>
            <p className="mt-1 text-sm text-slate-500">
              전체 엔진을 한 번에 막지 않고, 데이터가 없는 SKU만 개별 fail-closed 처리합니다.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            {new Date(report.generatedAt).toLocaleString("ko-KR")}
          </p>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {report.checks.map((item) => (
            <CheckCard key={item.key} item={item} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">상품등급·가격조정 그림자</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SmallMetric label="입력" value={price.inputCount} />
            <SmallMetric label="평가" value={price.evaluatedCount} />
            <SmallMetric label="완전일치" value={price.exactMatchCount} />
            <SmallMetric label="엔진차단" value={price.blockedCount} warning />
            <SmallMetric label="원인불명" value={price.unexplainedCount} danger />
            <SmallMetric label="표본" value={price.sampleCount} />
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            현재 Product Master 입력을 즉석에서 자체 가격등급 엔진으로 계산한 읽기 전용 미리보기입니다.
            원가가 없는 SKU는 가격·마진 보호 조치 대상에서 자동 제외됩니다.
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">발주 추천 전환</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SmallMetric
              label="판매 기준선"
              text={report.salesBaseline.state}
            />
            <SmallMetric
              label="판매 증분"
              text={report.salesIncremental.state}
            />
            <SmallMetric
              label="기존 Live 그림자"
              text={report.purchaseLegacyShadow.state}
            />
            <SmallMetric
              label="월 판매원장"
              value={report.salesBaseline.monthlyRowCount}
            />
            <SmallMetric
              label="증분 미연결"
              value={report.salesIncremental.unmappedRows}
              danger={report.salesIncremental.unmappedRows > 0}
            />
            <SmallMetric
              label="Planning SKU"
              value={report.planning.productCount}
            />
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            다음 전환은 발주 수요를 Product Master의 canonical 판매원장에서 직접 읽고,
            Shopling 직접조회는 클레임처럼 Product Master에 없는 보조신호로만 남기는 것입니다.
            미확인 재고는 확인재고 차감에 사용하지 않습니다.
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">다음 개발 순서</h2>
        <ol className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
          {report.nextDevelopment.map((item, index) => (
            <li key={item} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-700">
                {index + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 space-y-1 break-all text-xs text-slate-400">
          <p>Planning 지문 {report.planning.contentFingerprint}</p>
          <p>Inventory/Cost 지문 {report.inventoryCost.contentFingerprint}</p>
          <p>Price-grade 입력 지문 {report.priceGradePreview.contentFingerprint}</p>
        </div>
      </section>
    </>
  );
}

function CheckCard({ item }: { item: Stage8Check }) {
  const tone =
    item.state === "READY"
      ? "border-emerald-200 bg-emerald-50"
      : item.state === "BLOCKED" || item.state === "ERROR"
        ? "border-rose-200 bg-rose-50"
        : "border-amber-200 bg-amber-50";
  const badge =
    item.state === "READY"
      ? "준비"
      : item.state === "BLOCKED"
        ? "차단"
        : item.state === "ERROR"
          ? "오류"
          : "잠정";
  return (
    <article className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm text-slate-950">{item.label}</strong>
        <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] font-black text-slate-700">
          {badge}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{item.message}</p>
    </article>
  );
}

function Metric({
  label,
  value,
  note,
  tone = "white",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "white" | "green" | "amber" | "rose" | "slate";
}) {
  const classes = {
    white: "border-slate-200 bg-white",
    green: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
    slate: "border-slate-300 bg-slate-100",
  }[tone];
  return (
    <article className={`rounded-xl border p-4 ${classes}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">{value}</strong>
      {note ? <span className="mt-1 block text-xs text-slate-500">{note}</span> : null}
    </article>
  );
}

function SmallMetric({
  label,
  value,
  text,
  warning = false,
  danger = false,
}: {
  label: string;
  value?: number;
  text?: string;
  warning?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        danger
          ? "border-rose-200 bg-rose-50"
          : warning
            ? "border-amber-200 bg-amber-50"
            : "border-slate-200 bg-slate-50"
      }`}
    >
      <span className="block text-[11px] font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-sm text-slate-950">
        {text ?? number.format(value ?? 0)}
      </strong>
    </div>
  );
}
