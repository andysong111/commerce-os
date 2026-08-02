import { PageHeader } from "@/components/PageHeader";
import { ShoplingCategoryReviewQueue } from "@/components/shopling-category-review/ShoplingCategoryReviewQueue";

export default function ShoplingCategoryReviewQueuePage() {
  return (
    <>
      <PageHeader
        title="AI 카테고리 검토함"
        description="신규 상품 출시 진행관리에서 AI가 추천한 샵플링 표준카테고리를 다건 검토하고 승인·보류·제외합니다."
      />
      <section className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950 shadow-sm">
        <p className="font-bold">운영 원칙</p>
        <p className="mt-1 leading-6 text-blue-900">
          신뢰도가 높은 빈 카테고리는 자동입력하고, 검토 필요 상품만 이 대기열에 누적합니다. 승인된 값은 신규 상품 출시 진행관리의 샵플링 표준카테고리에 즉시 반영됩니다.
        </p>
      </section>
      <ShoplingCategoryReviewQueue />
    </>
  );
}
