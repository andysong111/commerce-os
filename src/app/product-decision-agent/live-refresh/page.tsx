import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadProductDecisionLiveStatus } from "@/lib/productDecisionLiveRefresh";
import { LiveRefreshControl } from "./LiveRefreshControl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductDecisionLiveRefreshPage() {
  const status = await loadProductDecisionLiveStatus().catch((error) => ({
    configured: false,
    requestId: null,
    state: "IDLE" as const,
    stage: "status-error",
    message:
      error instanceof Error
        ? error.message
        : "실시간 발주 계산 상태를 불러오지 못했습니다.",
    analysisAsOf: null,
    planningGeneratedAt: null,
    orderCompleted: 0,
    orderTotal: 0,
    claimCompleted: 0,
    claimTotal: 0,
    progress: 0,
    finalSnapshot: null,
    comparison: null,
    error:
      error instanceof Error
        ? error.message
        : "실시간 발주 계산 상태를 불러오지 못했습니다.",
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 발주 추천 자체 운영"
        title="실시간 판매 발주 계산"
        description="Ops Center가 Shopling 주문·클레임, Product Master 안정 SKU·원가·확인재고, 중국 미입고 원장을 직접 읽어 최근 360일 발주안을 처음부터 다시 계산합니다."
        actions={
          <Link
            href="/product-decision-agent"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            발주 추천으로 돌아가기
          </Link>
        }
      />

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <strong className="block text-base">운영 전환 전 그림자 계산</strong>
        <p className="mt-2 leading-6">
          전체 구간을 계산해도 기존 운영 발주안은 바꾸지 않습니다. 결과를 기존
          검증안과 비교한 뒤에만 운영 기준으로 승격합니다.
        </p>
        <p className="mt-2 text-xs text-amber-800">
          실제 1688 주문·결제·중국 전송·재고변경은 실행하지 않습니다.
        </p>
      </section>

      <LiveRefreshControl initialStatus={status} />
    </div>
  );
}
