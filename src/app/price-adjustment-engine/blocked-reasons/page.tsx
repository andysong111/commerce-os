import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadLatestPriceGradeBlockedReasonAudit } from "@/lib/priceGradeBlockedReasonAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function PriceGradeBlockedReasonsPage() {
  const result = await loadLatestPriceGradeBlockedReasonAudit().catch(
    () => null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 상품등급 입력 차단 전수점검"
        title="상품등급 차단 원인"
        description="가격등급 엔진이 계산을 멈춘 전체 상품을 원가·현재가·위치코드·판매상태 원인별로 중복까지 포함해 전수 집계합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/price-adjustment-engine/shadow-compare"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              그림자 비교로 돌아가기
            </Link>
            <Link
              href="/price-adjustment-engine"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              상품등급·가격조정
            </Link>
          </div>
        }
      />

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <strong className="block text-base">읽기 전용 원인 감사</strong>
        <p className="mt-2 leading-6">
          이 화면은 부족한 입력을 찾기 위한 진단 결과입니다. 실제 가격변경,
          등급 저장, 단종 확정, 재발주 제한은 실행하지 않습니다.
        </p>
      </section>

      {result ? (
        <>
          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong className="block text-base">전수 감사 완료</strong>
                <p className="mt-1 leading-6">{result.notice}</p>
              </div>
              <span className="rounded-full border border-blue-300 bg-white px-3 py-1 text-xs font-black text-blue-800">
                실제 쓰기 차단
              </span>
            </div>
            <p className="mt-3 text-xs text-blue-700">
              {new Date(result.generatedAt).toLocaleString("ko-KR")} · {result.auditVersion}
            </p>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="전체 입력" value={result.summary.inputCount} note="안정 SKU" />
            <Metric
              label="전체 차단"
              value={result.summary.blockedInputCount}
              note="사유 1개 이상"
              danger={result.summary.blockedInputCount > 0}
            />
            <Metric
              label="계산 가능"
              value={result.summary.unblockedInputCount}
              note="입력조건 충족"
              positive
            />
            <Metric
              label="기존 등급 있음"
              value={result.summary.blockedWithExistingLifecycleCount}
              note="기존 lifecycle 보유"
            />
            <Metric
              label="기존 등급 없음"
              value={result.summary.blockedWithoutExistingLifecycleCount}
              note="lifecycle 미생성"
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <CountTable
              title="원인별 전체 건수"
              description="한 상품에 원인이 여러 개면 각 원인에 모두 포함됩니다."
              rows={result.summary.reasonCounts}
            />
            <CountTable
              title="원인 조합별 상품 수"
              description="같은 상품에 동시에 발생한 원인을 하나의 조합으로 묶었습니다."
              rows={result.summary.combinationCounts}
            />
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="상품마스터 원가입력"
              value={result.receiptEvidence.productMasterReceiptProductCount}
              note="원시 입고행 보유"
            />
            <Metric
              label="입고캐시 보완"
              value={result.receiptEvidence.fallbackProductCount}
              note="최근 입고 3회 사용"
            />
            <Metric
              label="캐시 입고행"
              value={result.receiptEvidence.fallbackReceiptRowCount}
              note="보조 입력 행 수"
            />
            <Metric
              label="보완 후 원가 없음"
              value={result.receiptEvidence.remainingWithoutReceiptCount}
              note="원가 연결 추가 필요"
              danger={result.receiptEvidence.remainingWithoutReceiptCount > 0}
            />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">
                  차단 상품 표본
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  원인 확인용 최대 100건이며 실제 가격 작업과 연결되지 않습니다.
                </p>
              </div>
              <p className="text-xs text-slate-500">
                {result.summary.sampleTruncated
                  ? `전체 ${number.format(result.summary.blockedInputCount)}건 중 ${number.format(result.summary.sampleCount)}건 표시`
                  : `${number.format(result.summary.sampleCount)}건`}
              </p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[900px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-3">상품</th>
                    <th className="px-3 py-3">바코드</th>
                    <th className="px-3 py-3 text-right">현재가</th>
                    <th className="px-3 py-3">기존 등급</th>
                    <th className="px-3 py-3">차단 원인</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.samples.map((row) => (
                    <tr key={row.skuId}>
                      <td className="px-3 py-4">
                        <strong className="block max-w-sm text-slate-950">
                          {row.productName}
                        </strong>
                        {row.optionName ? (
                          <span className="mt-1 block text-xs text-slate-500">
                            {row.optionName}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-4 font-mono text-xs text-slate-600">
                        {row.barcode || "-"}
                      </td>
                      <td className="px-3 py-4 text-right font-semibold">
                        {number.format(row.currentPrice)}원
                      </td>
                      <td className="px-3 py-4 text-xs text-slate-600">
                        {row.hasExistingLifecycle ? "있음" : "없음"}
                      </td>
                      <td className="px-3 py-4 text-xs font-semibold text-rose-700">
                        {row.blockedReasons.join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          아직 저장된 차단 원인 감사 결과가 없습니다. 5분 예약 점검이 자동으로
          최초 결과를 생성합니다.
        </section>
      )}
    </div>
  );
}

function CountTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: Array<{ reason: string; count: number }>;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <div className="mt-4 space-y-2">
        {rows.length ? (
          rows.map((row) => (
            <div
              key={row.reason}
              className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <span className="text-sm font-semibold text-slate-700">
                {row.reason}
              </span>
              <strong className="text-base font-black text-slate-950">
                {number.format(row.count)}건
              </strong>
            </div>
          ))
        ) : (
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
            차단 원인이 없습니다.
          </p>
        )}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  note,
  positive = false,
  danger = false,
}: {
  label: string;
  value: number;
  note: string;
  positive?: boolean;
  danger?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        danger
          ? "border-rose-200"
          : positive
            ? "border-emerald-200"
            : "border-slate-200"
      }`}
    >
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <strong
        className={`mt-2 block text-2xl font-black ${
          danger
            ? "text-rose-700"
            : positive
              ? "text-emerald-700"
              : "text-slate-950"
        }`}
      >
        {number.format(value)}
      </strong>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </article>
  );
}
