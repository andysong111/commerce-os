import { PageHeader } from "@/components/PageHeader";
import { ShoplingCategoryCoreNounReview } from "@/components/shopling-category-review/ShoplingCategoryCoreNounReview";
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
          AI는 모델번호, 진행관리의 모델명, 옵션정보를 기준으로 분류합니다. 모델명에서 실제 제품명사를 먼저 찾고, 관련 카테고리가 없으면 엉뚱한 후보를 억지로 제시하지 않습니다. 승인된 값은 신규 상품 출시 진행관리의 샵플링 표준카테고리에 즉시 반영됩니다.
        </p>
      </section>
      <ShoplingCategoryCoreNounReview />
      <ShoplingCategoryReviewQueue />
    </>
  );
}
