import { FastPurchaseDraftActions } from "@/components/fast-purchase-mvp/FastPurchaseDraftActions";
import { FastPurchaseTriageWorkspace } from "@/components/fast-purchase-mvp/FastPurchaseTriageWorkspace";
import { PageHeader } from "@/components/PageHeader";
import { loadFastPurchaseMvpResilient } from "@/lib/fastPurchaseMvpResilient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const number = new Intl.NumberFormat("ko-KR");

export default async function FastPurchaseMvpPage() {
  const report = await loadFastPurchaseMvpResilient();
  const fallback = report.dataMode === "LAST_KNOWN_MANUAL_FALLBACK";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · FAST PURCHASE MVP V2.3"
        title="빠른 발주안 · MVP"
        description="완벽한 초기재고를 기다리지 않습니다. 시스템판정은 그대로 사용하고, 수동검토 상품은 창고 전수조사 없이 충분·부족·품절 정도만 빠르게 표시해 오늘 주문 예정수량을 직접 정할 수 있게 합니다. 검토가 끝나면 내부 Draft로 고정해 중복발주를 막습니다."
      />

      {fallback ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-xs font-black tracking-[0.12em] text-amber-700">TEMPORARY LIVE SOURCE FALLBACK</span>
              <h2 className="mt-1 text-xl font-black text-amber-950">실시간 호출 실패 · 마지막 정상 스냅샷으로 수동검토 계속 가능</h2>
            </div>
            <strong className="rounded-full bg-amber-900 px-4 py-2 text-sm text-white">자동발주 0 · 시스템판정 사용 안 함</strong>
          </div>
          <p className="mt-3 text-sm leading-6 text-amber-950">
            실시간 데이터가 일시적으로 끊겨도 화면을 닫지 않습니다. 이 상태에서는 아래 42개 상품의 마지막 정상 `재고0 수요참고`만 보여주며, 시스템 발주·보류 판정은 모두 비활성입니다. 재고 체감과 수동 주문 예정수량만 입력하고, 실시간 연결이 회복되면 새 fingerprint 기준으로 다시 확인합니다.
          </p>
          <p className="mt-2 font-mono text-xs text-amber-800">SOURCE ERROR · {report.sourceErrorCode ?? "UNKNOWN"}</p>
        </section>
      ) : null}

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY_MVP" ? "border-blue-200 bg-blue-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">FAST USE · PROVISIONAL V2.3 · OPERATE NOW</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">내부 Draft 가능 · 외부 자동주문 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-2 text-xs text-slate-500">{new Date(report.generatedAt).toLocaleString("ko-KR")} · {report.mode} · {report.dataMode}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-9">
        <Metric label="평가·검토 상품" value={number.format(report.evaluatedCount)} />
        <Metric label="시스템 판단" value={number.format(report.systemDecisionCount)} emphasized={!fallback} />
        <Metric label="수동 판단재료" value={number.format(report.manualTriageCount)} emphasized />
        <Metric label="운영 커버리지" value={number.format(report.operationalCoverageCount)} emphasized />
        <Metric label="발주 검토" value={number.format(report.orderReviewCount)} />
        <Metric label="발주 보류" value={number.format(report.holdCount)} />
        <Metric label="상한편향 판정" value={number.format(report.fallbackDecisionCount)} />
        <Metric label="수요만 검토" value={number.format(report.demandOnlyReviewCount)} />
        <Metric label="데이터 보류" value={number.format(report.dataHoldCount)} />
      </section>

      <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-sm leading-6 text-violet-950">
        <strong>지금은 정확도보다 실제 사용 흐름을 우선합니다.</strong><br />
        {fallback
          ? "현재는 마지막 정상 스냅샷의 재고0 수요참고만 사용합니다. 수동 판단·수량입력·CSV는 계속 가능하지만 시스템 발주/보류 판정은 사용하지 않습니다."
          : "재고증거가 있는 상품은 기존 `TWO_SIDED_BAND` 또는 `CUMULATIVE_UPPER_BIASED` 판단을 그대로 사용합니다. 재고증거가 없는 상품은 `DEMAND_ONLY_ZERO_STOCK_REFERENCE`의 재고 0 가정 수요를 참고값으로 보여주고, 아래 작업대에서 사용자가 재고 체감과 주문 예정수량을 직접 입력합니다. 이 참고값은 주문수량 상한이 아니며, 부족/품절로 판단한 상품은 SKU당 최대 9,999개까지 직접 입력할 수 있습니다."}
      </section>

      <FastPurchaseTriageWorkspace
        rows={report.rows}
        sourceFingerprint={report.fingerprint}
      />

      <FastPurchaseDraftActions
        rows={report.rows}
        sourceFingerprint={report.fingerprint}
        dataMode={report.dataMode}
      />

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>운영 경계</strong><br />
        빠른 재고판단·메모·주문 예정수량은 브라우저에서 편집하고, `내부 발주 Draft 저장`을 눌렀을 때만 Ops Center 원장에 RESERVED 약정으로 고정됩니다. 내부 Draft는 다음 발주안의 미입고 수량에 반영되어 중복발주를 막지만 중국 주문·결제는 자동 실행하지 않습니다. 실제 품절이 확인된 상품은 기존 정책대로 `SOLD_OUT_RESET=0` 기준점을 만들고, 이후 신규 입고·판매가 쌓일수록 수동판단 비중을 줄입니다.
      </section>

      <p className="break-all text-xs text-slate-400">Fingerprint · {report.fingerprint}</p>
    </div>
  );
}

function Metric({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <article className={`rounded-xl border bg-white p-4 ${emphasized ? "border-blue-300" : "border-slate-200"}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className={`mt-1 block text-xl ${emphasized ? "text-blue-700" : "text-slate-950"}`}>{value}</strong>
    </article>
  );
}
