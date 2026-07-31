import { PageHeader } from "@/components/PageHeader";
import { KeywordRecommendationRerunButton } from "@/components/product-launch-flow/KeywordRecommendationRerunButton";
import { ProductLaunchAiTitleTermsPanel } from "@/components/product-launch-flow/ProductLaunchAiTitleTermsPanel";
import { ProductLaunchFlowSimple } from "@/components/product-launch-flow/ProductLaunchFlowSimple";
import { ProductLaunchTrackerHandoffSync } from "@/components/product-launch-flow/ProductLaunchTrackerHandoffSync";

export default function ProductLaunchFlowPage() {
  return (
    <>
      <PageHeader
        title="상품 출시 플로우"
        description="실재고 행번호 또는 신규 상품 출시 진행관리의 등록완료 상품을 기준으로 검색어와 쇼핑몰별 상품명을 반영합니다. 마켓 전송은 직접 실행합니다."
      />
      <ProductLaunchTrackerHandoffSync />
      <KeywordRecommendationRerunButton />
      <ProductLaunchAiTitleTermsPanel />
      <ProductLaunchFlowSimple />
    </>
  );
}
