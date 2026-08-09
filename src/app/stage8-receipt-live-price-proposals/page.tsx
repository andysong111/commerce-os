import { PageHeader } from "@/components/PageHeader";
import { loadReceiptLivePriceProposalStatus } from "@/lib/receiptLivePriceProposalWorker";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function ReceiptLivePriceProposalsPage() {
  const status = await loadReceiptLivePriceProposalStatus();
  const proposal = status.latestProposal;
  const candidates = proposal?.goodsKeyProposals.filter((row) => row.canaryEligible) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · RECEIPT EVENT LIVE PRICE PROPOSAL"
        title="입고확정 → 샵플링 LIVE 가격제안"
        description="새 입고확정 이벤트만 durable 원장에서 읽습니다. 해당 batch의 실제 입고수량·원가를 중국 발주 시스템에서 batchId로 다시 증명하고, 그 B-code의 현재 Shopling 판매가만 즉시 조회한 뒤 가격등급 엔진으로 변경안을 만듭니다. 이 단계는 가격을 쓰지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Rollout" value={status.rolloutReady ? "READY" : "NOT INITIALIZED"} />
        <Metric label="Rollout 기준" value={status.rolloutStartedAt ?? "-"} />
        <Metric label="대기 입고이벤트" value={number.format(status.pendingReceiptCount)} />
        <Metric label="최근 제안" value={proposal?.state ?? "없음"} />
        <Metric label="실제 가격 write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-xs font-black tracking-[0.14em] text-slate-500">NEW RECEIPT EVENTS ONLY</span>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              기존 입고는 소급 가격변경하지 않습니다
            </h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">
            CANARY WRITE STILL OFF
          </strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">
          Worker가 처음 활성화된 시점을 rollout 기준점으로 저장합니다. 그 이후 새로 들어온 입고확정 이벤트만 처리하므로 과거 입고기록 때문에 현재 Shopling 가격이 갑자기 일괄 변경되는 일을 막습니다.
        </p>
      </section>

      {proposal ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="제안상태" value={proposal.state} />
            <Metric label="Batch" value={number.format(proposal.batchId)} />
            <Metric label="정확 입고행" value={number.format(proposal.exactReceiptRowCount)} />
            <Metric label="입고 B-code" value={number.format(proposal.exactReceiptBarcodeCount)} />
            <Metric label="가격변경 옵션" value={number.format(proposal.changedListingCount)} />
            <Metric label="Canary 후보 goods_key" value={number.format(proposal.eligibleGoodsKeyCount)} />
          </section>

          <section className={`rounded-2xl border p-5 shadow-sm ${proposal.state === "READY" ? "border-emerald-200 bg-emerald-50" : proposal.state === "NO_CHANGE" ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold text-slate-500">LATEST PROPOSAL</span>
                <h2 className="mt-1 text-2xl font-black text-slate-950">{proposal.state}</h2>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700">
                {proposal.currentPriceSource}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-700">{proposal.message}</p>
            <div className="mt-4 grid gap-2 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-4">
              <Info label="Receipt event" value={proposal.eventId} breakAll />
              <Info label="Receipt" value={proposal.receiptId} breakAll />
              <Info label="Receipt source" value={proposal.sourceMode} />
              <Info label="Rule" value={proposal.priceRuleVersion} />
              <Info label="Event time" value={proposal.eventOccurredAt} />
              <Info label="Proposal time" value={proposal.generatedAt} />
              <Info label="Receipt cost" value={proposal.receiptCostSource} />
              <Info label="Fingerprint" value={proposal.fingerprint} breakAll />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">가격변경 옵션 제안</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  현재가는 Shopling LIVE 값입니다. 입고 batch 원가를 기존 최근 3회 보호원가 규칙에 합친 뒤 목표가와 조정률을 계산합니다.
                </p>
              </div>
              <span className="text-xs font-bold text-slate-500">{number.format(proposal.listingProposalCount)}개 옵션행</span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1900px] text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-2">B-code</th>
                    <th className="px-3 py-2">상품</th>
                    <th className="px-3 py-2">goods_key</th>
                    <th className="px-3 py-2">그룹</th>
                    <th className="px-3 py-2">현재 LIVE</th>
                    <th className="px-3 py-2">입고수량</th>
                    <th className="px-3 py-2">이번 원가</th>
                    <th className="px-3 py-2">보호원가</th>
                    <th className="px-3 py-2">마진하한</th>
                    <th className="px-3 py-2">판정</th>
                    <th className="px-3 py-2">목표가</th>
                    <th className="px-3 py-2">조정률</th>
                    <th className="px-3 py-2">변경필요</th>
                    <th className="px-3 py-2">차단</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.listingProposals.map((row) => (
                    <tr key={`${row.barcode}:${row.goodsKey}:${row.optionId}`} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 font-mono font-black">{row.barcode}</td>
                      <td className="px-3 py-2"><strong>{row.productName}</strong><br /><span className="text-slate-400">{row.optionName ?? "-"}</span></td>
                      <td className="px-3 py-2 font-mono">{row.goodsKey}<br /><span className="text-slate-400">{row.optionId || "단품"}</span></td>
                      <td className="px-3 py-2">{row.productGroup || "-"}</td>
                      <td className="px-3 py-2 font-black">{number.format(row.currentEffectiveSalePrice)}원</td>
                      <td className="px-3 py-2">{number.format(row.latestBatchQuantity)}</td>
                      <td className="px-3 py-2">{number.format(row.latestBatchUnitCostKrw)}원</td>
                      <td className="px-3 py-2">{number.format(row.protectionCostKrw)}원</td>
                      <td className="px-3 py-2">{number.format(row.marginFloorPrice)}원</td>
                      <td className="px-3 py-2 font-bold">{row.decision}</td>
                      <td className="px-3 py-2 font-black">{number.format(row.targetEffectiveSalePrice)}원</td>
                      <td className="px-3 py-2">{(row.adjustmentBps / 100).toFixed(2)}%</td>
                      <td className="px-3 py-2 font-bold">{row.priceChangeRequired ? "YES" : "NO"}</td>
                      <td className="px-3 py-2">{row.blockedReasons.join(", ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">goods_key Canary 후보</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  같은 goods_key의 모든 활성 B-code 소유자가 이번 입고 영향범위에 있고, 모든 변경 옵션의 조정률이 하나로 일치해야 후보가 됩니다.
                </p>
              </div>
              <span className="text-xs font-bold text-emerald-700">{number.format(candidates.length)}개 ELIGIBLE</span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1300px] text-left text-xs">
                <thead className="text-slate-500"><tr><th className="px-3 py-2">goods_key</th><th className="px-3 py-2">그룹</th><th className="px-3 py-2">소유 B-code</th><th className="px-3 py-2">계획 B-code</th><th className="px-3 py-2">변경 옵션</th><th className="px-3 py-2">조정률</th><th className="px-3 py-2">Canary</th><th className="px-3 py-2">차단사유</th></tr></thead>
                <tbody>{proposal.goodsKeyProposals.map((row) => (
                  <tr key={row.goodsKey} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono font-black">{row.goodsKey}</td>
                    <td className="px-3 py-2">{row.productGroup || "-"}</td>
                    <td className="px-3 py-2">{row.ownerBarcodes.join(", ") || "-"}</td>
                    <td className="px-3 py-2">{row.plannedBarcodes.join(", ") || "-"}</td>
                    <td className="px-3 py-2">{number.format(row.changedListingCount)}</td>
                    <td className="px-3 py-2">{row.adjustmentBps === null ? "-" : `${(row.adjustmentBps / 100).toFixed(2)}%`}</td>
                    <td className={`px-3 py-2 font-black ${row.canaryEligible ? "text-emerald-700" : "text-slate-500"}`}>{row.canaryEligible ? "ELIGIBLE" : "BLOCKED"}</td>
                    <td className="px-3 py-2">{row.blockedReason ?? "-"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
          아직 rollout 이후 처리된 새 입고확정 가격제안이 없습니다.
        </section>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4"><span className="text-xs font-semibold text-slate-500">{label}</span><strong className="mt-1 block break-all text-lg text-slate-950">{value}</strong></article>;
}

function Info({ label, value, breakAll = false }: { label: string; value: string; breakAll?: boolean }) {
  return <div className={`rounded-xl bg-white/70 p-3 ${breakAll ? "break-all" : ""}`}><strong>{label}</strong><br />{value}</div>;
}
