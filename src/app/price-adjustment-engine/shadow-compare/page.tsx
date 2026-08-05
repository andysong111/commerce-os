import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadLatestPriceGradeShadowComparison } from "@/lib/priceGradeShadowComparison";
import { ShadowCompareControl } from "./ShadowCompareControl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PriceGradeShadowComparePage() {
  const initialResult = await loadLatestPriceGradeShadowComparison().catch(
    () => null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 상품등급 자체 엔진 검증"
        title="상품등급 그림자 비교"
        description="Product Master의 안정 SKU 판매·입고원가 원장을 Ops Center 자체 가격등급 엔진으로 다시 계산하고 기존 lifecycle과 비교합니다."
        actions={
          <Link
            href="/price-adjustment-engine"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            상품등급·가격조정으로 돌아가기
          </Link>
        }
      />

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <strong className="block text-base">운영 전환 차단 상태</strong>
        <p className="mt-2 leading-6">
          그림자 비교는 원인을 분류하기 위한 읽기·계산 작업입니다. 원인 추가분석
          건수가 0이 되고 별도 승인되기 전에는 가격 Bulk 실행기와 연결하지
          않습니다.
        </p>
        <p className="mt-2 text-xs text-amber-800">
          실제 가격변경·등급 저장·단종 확정·재발주 제한은 실행하지 않습니다.
        </p>
      </section>

      <ShadowCompareControl initialResult={initialResult} />
    </div>
  );
}
