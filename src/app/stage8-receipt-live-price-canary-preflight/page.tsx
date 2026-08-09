import { PageHeader } from "@/components/PageHeader";
import { loadReceiptLivePriceCanaryPreflightStatus } from "@/lib/receiptLivePriceCanaryPreflight";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function ReceiptLivePriceCanaryPreflightPage() {
  const status = await loadReceiptLivePriceCanaryPreflightStatus();
  const report = status.report;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · RECEIPT LIVE PRICE CANARY PREFLIGHT"
        title="입고확정 가격변경 1건 Canary 사전검증"
        description="실제 가격을 바꾸기 전에 가장 안전한 goods_key 1개만 고르고, 현재 Shopling base/옵션금액을 읽기 전용 가격계획과 다시 대조합니다. 제안 시점과 현재값이 조금이라도 다르면 차단하며 이 화면에서는 가격을 변경하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="상태" value={status.state} />
        <Metric label="goods_key" value={status.goodsKey ?? "-"} />
        <Metric label="제안지문" value={status.proposalFingerprint ?? "-"} small />
        <Metric label="실제 가격 write" value="0" />
        <Metric label="Canary write" value="OFF" />
      </section>

      <section
        className={`rounded-2xl border p-5 shadow-sm ${
          status.state === "READY_ONE_GOODS_KEY"
            ? "border-emerald-200 bg-emerald-50"
            : status.state === "BLOCKED"
              ? "border-rose-200 bg-rose-50"
              : "border-slate-200 bg-white"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.14em] text-slate-500">
              FAIL-CLOSED · READ ONLY
            </span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{status.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">
            OPERATOR APPROVAL NOT OPEN
          </strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{status.message}</p>
      </section>

      {report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="Batch" value={number.format(report.batchId)} />
            <Metric label="그룹" value={report.productGroup || "-"} />
            <Metric label="조정률" value={`${(report.adjustmentBps / 100).toFixed(2)}%`} />
            <Metric label="현재 base" value={`${number.format(report.expectedCurrentSellPrice)}원`} />
            <Metric label="목표 base" value={`${number.format(report.targetSellPrice)}원`} />
            <Metric label="모드" value="OPTION AWARE" />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">현재값 ↔ 읽기 전용 Plan 대사</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Info label="Receipt event" value={report.receiptEventId} breakAll />
              <Info label="Receipt" value={report.receiptId} breakAll />
              <Info label="Plan request" value={report.planRequestId} breakAll />
              <Info label="Plan run" value={String(report.planRunId)} />
              <Info
                label="현재 옵션 추가금"
                value={report.currentOptionAmounts.length ? report.currentOptionAmounts.map((value) => `${number.format(value)}원`).join(" / ") : "옵션 추가금 없음"}
              />
              <Info
                label="목표 옵션 추가금"
                value={report.targetOptionAmounts.length ? report.targetOptionAmounts.map((value) => `${number.format(value)}원`).join(" / ") : "옵션 추가금 없음"}
              />
              <Info
                label="현재 실판매가"
                value={report.currentEffectivePrices.map((value) => `${number.format(value)}원`).join(" / ")}
              />
              <Info
                label="목표 실판매가"
                value={report.targetEffectivePrices.map((value) => `${number.format(value)}원`).join(" / ")}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
            <strong>다음 실제 변경 단계는 아직 잠겨 있습니다.</strong>
            <br />
            이 사전검증은 현재 base 판매가와 옵션 추가금, 옵션 구조 서명, 목표 실판매가가 모두 입고확정 가격제안과 일치하는지 확인하는 단계입니다. 실제 Shopling 1건 canary는 운영 로그인/권한과 별도 write 승인을 준비한 뒤에만 엽니다.
            <div className="mt-3 break-all text-xs text-amber-800">
              Option signature · {report.expectedOptionSignature}
              <br />
              Preflight fingerprint · {report.fingerprint}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  small = false,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong
        className={`mt-1 block break-all text-slate-950 ${small ? "text-xs" : "text-lg"}`}
      >
        {value}
      </strong>
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
    <div className={`rounded-xl bg-slate-50 p-3 text-xs text-slate-700 ${breakAll ? "break-all" : ""}`}>
      <strong className="text-slate-950">{label}</strong>
      <br />
      {value}
    </div>
  );
}
