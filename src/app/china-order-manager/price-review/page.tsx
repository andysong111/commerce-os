import Link from "next/link";
import { InternalChinaGroupCostPriceApprovalButton } from "@/components/china-order-manager/InternalChinaGroupCostPriceApprovalButton";
import { InternalChinaHistoricalProductGroupImport } from "@/components/china-order-manager/InternalChinaHistoricalProductGroupImport";
import {
  loadInternalChinaGroupCostPriceApproval,
  loadLatestInternalChinaGroupCostPriceProposal,
} from "@/lib/internalChinaGroupCostPriceReview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

function monthLabel(value: string) {
  const matched = value.match(/^(\d{4})-(\d{2})$/);
  return matched ? `${Number(matched[1])}년 ${Number(matched[2])}월` : value;
}

function directionLabel(direction: string) {
  if (direction === "INCREASE") return "원가 방어 인상";
  if (direction === "DECREASE") return "원가 하락 인하";
  if (direction === "HOLD") return "유지";
  return "검토 차단";
}

function directionClass(direction: string) {
  if (direction === "INCREASE") return "bg-rose-50 text-rose-700";
  if (direction === "DECREASE") return "bg-blue-50 text-blue-700";
  if (direction === "HOLD") return "bg-slate-100 text-slate-700";
  return "bg-amber-50 text-amber-800";
}

function saleStatusLabel(status: string, active: boolean | null) {
  if (active === null) return "-";
  if (active) return status ? `${status} · 판매중` : "판매중";
  return `${status || "미확인"} · 제외`;
}

export default async function InternalChinaCostPriceReviewPage() {
  const latest = await loadLatestInternalChinaGroupCostPriceProposal();
  const proposal = latest.proposal;
  const approval = proposal
    ? await loadInternalChinaGroupCostPriceApproval(proposal.fingerprint)
    : null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-xs font-black tracking-[0.14em] text-blue-700">
              INTERNAL CHINA · GROUP-AWARE COST PRICE V2
            </span>
            <h1 className="mt-1 text-2xl font-black text-slate-950">
              실제원가 · 상품그룹 가격조정 검토
            </h1>
            <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-600">
              상품등급은 사용하지 않습니다. 확정 실제원가 × 주문당 수량 × 2에 도매1~도매4·소매1~소매2 내부 가격그룹 배수를 적용합니다. 신규 SEO 상품은 Shopling 상품그룹을 계속 미지정으로 두고 OPS 내부 가격그룹만 사용합니다. Shopling sale_status도 실시간 재조회해 현재 판매중이 아닌 구형 listing은 가격조정 대상에서 제외합니다. 내부 그룹 근거가 없는 판매중 listing도 그룹을 추측하지 않고 행 단위로 자동 제외하며, 확정 그룹 행만 승인 범위에 들어갑니다. 실제 Shopling 가격 쓰기는 승인 이후 별도 단계입니다.
            </p>
          </div>
          <Link
            href="/china-order-manager"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700"
          >
            ← 중국 발주·입고 관리
          </Link>
        </div>
      </section>

      {!proposal ? (
        <>
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
            상품그룹 정책 V2 가격조정안이 아직 없습니다. 기존 V1 가격조정안은 승인 대상으로 사용하지 않습니다. 아래 구형상품 그룹파일을 한 번 가져오면 V2를 즉시 재산출합니다.
          </section>
          <InternalChinaHistoricalProductGroupImport />
        </>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-9">
            <Metric label="사이클" value={monthLabel(proposal.cycleMonth)} />
            <Metric label="대상 B-code" value={number.format(proposal.affectedBarcodeCount)} />
            <Metric label="원가 방어 인상" value={number.format(proposal.increaseCount)} />
            <Metric label="원가 하락 인하" value={number.format(proposal.decreaseCount)} />
            <Metric label="유지" value={number.format(proposal.holdCount)} />
            <Metric label="검토 차단" value={number.format(proposal.blockedCount)} />
            <Metric label="그룹 미확정 자동제외" value={number.format(proposal.unresolvedGroupCount)} />
            <Metric label="판매중지 제외" value={number.format(proposal.inactiveListingCount)} />
            <Metric label="Shopling 실조회 누락" value={number.format(proposal.liveListingMissingCount)} />
          </section>

          {proposal.unresolvedGroupCount > 0 ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
              판매중이지만 6개 내부 가격그룹 근거가 없는 {number.format(proposal.unresolvedGroupCount)}개 옵션행은 가격 자동화 범위에서 제외했습니다. 기존 그룹파일·GOODSKEY·가격 패턴으로 임의 추정하지 않으며, 이 행들 때문에 근거가 확정된 다른 상품의 가격 검토 전체를 막지 않습니다.
            </section>
          ) : null}

          <section
            className={`rounded-2xl border p-5 shadow-sm ${
              approval
                ? "border-emerald-200 bg-emerald-50"
                : proposal.state === "AWAITING_APPROVAL"
                  ? "border-blue-200 bg-blue-50"
                  : proposal.state === "BLOCKED"
                    ? "border-amber-200 bg-amber-50"
                    : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-slate-500">PRICE REVIEW STATE</span>
                <h2 className="mt-1 text-xl font-black text-slate-950">
                  {approval
                    ? "확정 그룹 가격조정안 승인 완료"
                    : proposal.state === "AWAITING_APPROVAL"
                      ? "확정 그룹 가격조정안 승인 대기"
                      : proposal.state === "NO_CHANGE"
                        ? "확정 그룹 가격변경 없음"
                        : "관리 가능한 가격행 없음 · 검토 차단"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  규칙 {proposal.ruleVersion} · 가격변경 대상 {number.format(proposal.changedRowCount)}개 옵션행 · 판매중 그룹 미확정 자동제외 {number.format(proposal.unresolvedGroupCount)}개 · 판매중지 제외 {number.format(proposal.inactiveListingCount)}개 · Shopling 실조회 누락 {number.format(proposal.liveListingMissingCount)}개 · 실제 Shopling 가격 write 0건
                </p>
                {proposal.unresolvedGroupCount > 0 ? (
                  <p className="mt-2 text-xs font-bold text-amber-800">
                    미확정 GOODSKEY는 승인·향후 가격 write 범위에 들어가지 않습니다. 확정 그룹 + 판매중 + 차단사유 없음 조건을 모두 만족하는 가격변경 행만 승인 대상으로 계산합니다.
                  </p>
                ) : null}
              </div>
              {approval ? (
                <div className="rounded-xl bg-white px-4 py-3 text-right text-xs text-emerald-800">
                  <strong className="block">승인 기록 완료</strong>
                  <span className="mt-1 block">{new Date(approval.approvedAt).toLocaleString("ko-KR")}</span>
                  <span className="mt-1 block">승인 {number.format(approval.approvedChangedRowCount)}행 · 제외 {number.format(approval.excludedBlockedRowCount ?? proposal.blockedCount)}행</span>
                  <span className="mt-1 block font-bold">SHOPLING WRITE OFF</span>
                </div>
              ) : proposal.state === "AWAITING_APPROVAL" ? (
                <InternalChinaGroupCostPriceApprovalButton
                  proposalFingerprint={proposal.fingerprint}
                  changedRowCount={proposal.changedRowCount}
                />
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">상품그룹 가격조정안 상세</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  그룹 기준가 = 확정원가 × 주문당 수량 × 2 × 그룹배수, 10원 올림 · 도매1 1.00 / 도매2 1.15 / 도매3 1.10 / 도매4 1.30 / 소매1 1.30 / 소매2 1.40 · 카페24 0.97배 / 도매창고 +500원 / 에이블리 +3,000원은 쇼핑몰 목표가에 별도 반영 · Shopling sale_status B 또는 빈값만 판매중으로 취급
                </p>
              </div>
              <span className="text-xs font-bold text-slate-500">
                {number.format(proposal.listingRowCount)}개 옵션행
              </span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[2180px] text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-2">B-code</th>
                    <th className="px-3 py-2">상품 / 옵션</th>
                    <th className="px-3 py-2">goods_key</th>
                    <th className="px-3 py-2">Shopling 상태</th>
                    <th className="px-3 py-2">OPS 내부 그룹</th>
                    <th className="px-3 py-2">그룹근거</th>
                    <th className="px-3 py-2">그룹배수</th>
                    <th className="px-3 py-2">주문당수량</th>
                    <th className="px-3 py-2">현재가</th>
                    <th className="px-3 py-2">이번 실제원가</th>
                    <th className="px-3 py-2">직전 실제원가</th>
                    <th className="px-3 py-2">그룹 기준가</th>
                    <th className="px-3 py-2">연결 쇼핑몰 목표</th>
                    <th className="px-3 py-2">판정</th>
                    <th className="px-3 py-2">근거</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.rows.map((row, index) => (
                    <tr
                      key={`${row.barcode}:${row.goodsKey}:${row.optionId}:${index}`}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="px-3 py-2 font-mono font-black">{row.barcode}</td>
                      <td className="px-3 py-2">
                        <strong>{row.productName}</strong>
                        <br />
                        <span className="text-slate-400">{row.optionName || "단품"}</span>
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {row.goodsKey || "-"}
                        <br />
                        <span className="text-slate-400">{row.optionId || "단품"}</span>
                      </td>
                      <td className={`px-3 py-2 font-bold ${row.saleStatusActive === false ? "text-amber-700" : "text-slate-700"}`}>
                        {saleStatusLabel(row.saleStatus, row.saleStatusActive)}
                      </td>
                      <td className="px-3 py-2 font-black">{row.productGroup || "미확정"}</td>
                      <td className="px-3 py-2 text-slate-500">{row.productGroupSource}</td>
                      <td className="px-3 py-2 font-black">{row.groupMultiplier === null ? "-" : row.groupMultiplier.toFixed(2)}</td>
                      <td className="px-3 py-2 font-bold">{number.format(row.unitsPerOrder)}개</td>
                      <td className="px-3 py-2 font-black">{row.currentPrice ? `${number.format(row.currentPrice)}원` : "-"}</td>
                      <td className="px-3 py-2 font-black">{number.format(row.latestCostKrw)}원</td>
                      <td className="px-3 py-2">{row.previousCostKrw === null ? "없음" : `${number.format(row.previousCostKrw)}원`}</td>
                      <td className="px-3 py-2 font-black">{row.targetPrice ? `${number.format(row.targetPrice)}원` : "-"}</td>
                      <td className="max-w-[400px] px-3 py-2 leading-5 text-slate-600">
                        {row.mallTargets.length
                          ? row.mallTargets
                              .map((mall) => `${mall.mallName} ${number.format(mall.targetPrice)}원`)
                              .join(" · ")
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2.5 py-1 font-black ${directionClass(row.direction)}`}>
                          {directionLabel(row.direction)}
                        </span>
                      </td>
                      <td className="max-w-[430px] px-3 py-2 leading-5 text-slate-600">
                        {row.reason}
                        {row.blockedReason ? (
                          <>
                            <br />
                            <span className="font-mono text-amber-700">{row.blockedReason}</span>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block break-all text-lg text-slate-950">{value}</strong>
    </article>
  );
}