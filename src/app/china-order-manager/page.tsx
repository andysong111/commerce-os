import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadChinaOrderInternalStatus } from "@/lib/integrations/chinaOrderManager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function ChinaOrderManagerPage() {
  const status = await loadChinaOrderInternalStatus();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 중국 발주·입고 내부 이전"
        title="중국 발주·입고 관리"
        description="기존 독립 Site의 업무를 Ops Center 내부 주문·입고 원장으로 옮기는 운영 화면입니다. 현재는 내부 원가계산과 실행원장 조회를 사용하며 실제 입고·재고 변경은 차단합니다."
        actions={
          <Link
            href="/china-orders"
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
          >
            내부 원가계산 열기
          </Link>
        }
      />

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-base">Ops Center 내부 진입점 전환 완료</strong>
            <p className="mt-1 leading-6">
              외부 ChatGPT Site로 자동 이동하지 않습니다. 원가계산·상품마스터 연결·운영 이력 확인을 Ops Center 안에서 진행합니다.
            </p>
          </div>
          <span className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-black text-emerald-800">
            실제 입고·재고 쓰기 차단
          </span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard label="운영원장 감지" value={number.format(status.operationCount)} note="중국발주·입고 관련 최근 작업" />
        <StatusCard label="성공 이력" value={number.format(status.succeededCount)} note="SUCCEEDED 상태" />
        <StatusCard label="실패 이력" value={number.format(status.failedCount)} note="원인 확인 필요" danger={status.failedCount > 0} />
        <StatusCard
          label="최근 작업시각"
          value={status.latestOperationAt ? new Date(status.latestOperationAt).toLocaleString("ko-KR") : "없음"}
          note={status.sourceMode === "ops_ledger" ? "Ops Center Supabase" : "원장 이전 준비"}
        />
      </section>

      {status.error ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <strong>운영원장 조회 안내</strong>
          <p className="mt-2 break-words">{status.error}</p>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <ActionCard
          title="중국주문 원가계산"
          description="상품마스터의 모델·옵션을 연결하고 중국내 운임과 환율을 배분해 옵션별 최종 원가를 계산합니다."
          href="/china-orders"
          action="원가계산 열기"
          state="사용 가능"
        />
        <ActionCard
          title="운영 안전센터"
          description="입고확정 이벤트, 실패·재시도, 가격분석 후속 연동과 불확실 상태를 확인합니다."
          href="/operations"
          action="운영 이력 보기"
          state="읽기 전용"
        />
        <ActionCard
          title="발주 추천"
          description="중국 주문초안·실주문·미입고 수량이 다음 발주안에서 중복 차감되는지 확인합니다."
          href="/product-decision-agent"
          action="발주 추천 보기"
          state="그림자 운영"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">남은 내부화 작업</h2>
        <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
          <p className="rounded-xl bg-slate-50 p-4">주문초안·실제 주문수량을 Ops Center 발주차시 원장에 저장</p>
          <p className="rounded-xl bg-slate-50 p-4">부분입고·정상입고·파손·누락 상태를 이벤트 원장으로 멱등 반영</p>
          <p className="rounded-xl bg-slate-50 p-4">확정 원가를 상품마스터와 가격조정 엔진에 전달</p>
          <p className="rounded-xl bg-slate-50 p-4">기존 integration_outbox와 Worker를 하나로 전환</p>
        </div>
      </section>
    </div>
  );
}

function StatusCard({
  label,
  value,
  note,
  danger = false,
}: {
  label: string;
  value: string;
  note: string;
  danger?: boolean;
}) {
  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-sm ${danger ? "border-rose-200" : "border-slate-200"}`}>
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <strong className={`mt-2 block break-words text-2xl font-black ${danger ? "text-rose-700" : "text-slate-950"}`}>
        {value}
      </strong>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </article>
  );
}

function ActionCard({
  title,
  description,
  href,
  action,
  state,
}: {
  title: string;
  description: string;
  href: string;
  action: string;
  state: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{state}</span>
      <h2 className="mt-4 text-lg font-black text-slate-950">{title}</h2>
      <p className="mt-2 min-h-16 text-sm leading-6 text-slate-600">{description}</p>
      <Link href={href} className="mt-5 inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">
        {action}
      </Link>
    </article>
  );
}
