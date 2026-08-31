import Link from "next/link";
import { InternalChinaCostPriceApprovalButton } from "@/components/china-order-manager/InternalChinaCostPriceApprovalButton";
import {
  loadInternalChinaCostPriceApproval,
  loadLatestInternalChinaCostPriceProposal,
} from "@/lib/internalChinaCostPriceReview";

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

export default async function InternalChinaCostPriceReviewPage() {
  const latest = await loadLatestInternalChinaCostPriceProposal();
  const proposal = latest.proposal;
  const approval = proposal
    ? await loadInternalChinaCostPriceApproval(proposal.fingerprint)
    : null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-xs font-black tracking-[0.14em] text-blue-700">
              INTERNAL CHINA · COST-ONLY PRICE REVIEW
            </span>
            <h1 className="mt-1 text-2xl font-black text-slate-950">
              실제원가 기반 가격조정 검토
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              상품등급·매출등급은 사용하지 않습니다. 입고 후 확정된 실제 매입원가와 현재 Shopling 판매가만 비교해 원가 방어 인상, 원가 하락 인하, 유지로 나눕니다. 이 화면의 승인까지는 실제 Shopling 가격을 쓰지 않습니다.
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
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
          아직 실제원가 마감에서 생성된 가격조정안이 없습니다. OPS dispatcher가 실제원가 마감 건을 감지하면 자동으로 가격조정안을 생성합니다. 실제 Shopling 가격 쓰기는 비활성 상태입니다.
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="사이클" value={monthLabel(proposal.cycleMonth)} />
            <Metric label="대상 B-code" value={number.format(proposal.affectedBarcodeCount)} />
            <Metric label="원가 방어 인상" value={number.format(proposal.increaseCount)} />
            <Metric label="원가 하락 인하" value={number.format(proposal.decreaseCount)} />
            <Metric label="유지" value={number.format(proposal.holdCount)} />
            <Metric label="검토 차단" value={number.format(proposal.blockedCount)} />
          </section>

          <section className={`rounded-2xl border p-5 shadow-sm ${approval ? "border-emerald-200 bg-emerald-50" : proposal.state === "AWAITING_APPROVAL" ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-slate-500">PRICE REVIEW STATE</span>
                <h2 className="mt-1 text-xl font-black text-slate-950">
                  {approval
                    ? "가격조정안 승인 완료"
                    : proposal.state === "AWAITING_APPROVAL"
                      ? "가격조정안 승인 대기"
                      : proposal.state === "NO_CHANGE"
                        ? "가격변경 없음"
                        : "일부 검토 차단"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  규칙 {proposal.ruleVersion} · 가격변경 대상 {number.format(proposal.changedRowCount)}개 옵션행 · 실제 Shopling 가격 write 0건
                </p>
              </div>
              {approval ? (
                <div className="rounded-xl bg-white px-4 py-3 text-right text-xs text-emerald-800">
                  <strong className="block">승인 기록 완료</strong>
                  <span className="mt-1 block">{new Date(approval.approvedAt).toLocaleString("ko-KR")}</span>
                  <span className="mt-1 block font-bold">SHOPLING WRITE OFF</span>
                </div>
              ) : proposal.state === "AWAITING_APPROVAL" ? (
                <InternalChinaCostPriceApprovalButton
                  proposalFingerprint={proposal.fingerprint}
                  changedRowCount={proposal.changedRowCount}
                />
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">가격조정안 상세</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  인상: 현재가가 확정원가 × 주문당 수량 × 2보다 낮음 · 인하: 직전 확정원가보다 실제원가가 하락했고 현재가가 새 2배 원가선보다 높음 · 직전 확정원가가 없으면 인하하지 않음
                </p>
              </div>
              <span className="text-xs font-bold text-slate-500">
                {number.format(proposal.listingRowCount)}개 옵션행
              </span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1650px] text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-2">B-code</th>
                    <th className="px-3 py-2">상품 / 옵션</th>
                    <th className="px-3 py-2">goods_key</th>
                    <th className="px-3 py-2">주문당수량</th>
                    <th className="px-3 py-2">현재가</th>
                    <th className="px-3 py-2">이번 실제원가</th>
                    <th className="px-3 py-2">직전 실제원가</th>
                    <th className="px-3 py-2">원가변동</th>
                    <th className="px-3 py-2">목표가</th>
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
                      <td className="px-3 py-2 font-bold">{number.format(row.unitsPerOrder)}개</td>
                      <td className="px-3 py-2 font-black">{row.currentPrice ? `${number.format(row.currentPrice)}원` : "-"}</td>
                      <td className="px-3 py-2 font-black">{number.format(row.latestCostKrw)}원</td>
                      <td className="px-3 py-2">{row.previousCostKrw === null ? "없음" : `${number.format(row.previousCostKrw)}원`}</td>
                      <td className="px-3 py-2">{row.costChangeRate === null ? "-" : `${(row.costChangeRate * 100).toFixed(2)}%`}</td>
                      <td className="px-3 py-2 font-black">{row.targetPrice ? `${number.format(row.targetPrice)}원` : "-"}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2.5 py-1 font-black ${directionClass(row.direction)}`}>
                          {directionLabel(row.direction)}
                        </span>
                      </td>
                      <td className="max-w-[430px] px-3 py-2 leading-5 text-slate-600">
                        {row.reason}
                        {row.blockedReason ? <><br /><span className="font-mono text-amber-700">{row.blockedReason}</span></> : null}
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
