import { PageHeader } from "@/components/PageHeader";
import { KeywordRecommendationRerunButton } from "@/components/product-launch-flow/KeywordRecommendationRerunButton";
import { ProductLaunchAiTitleTermsPanel } from "@/components/product-launch-flow/ProductLaunchAiTitleTermsPanel";
import { ProductLaunchFlowConnected } from "@/components/product-launch-flow/ProductLaunchFlowConnected";
import { ProductLaunchTrackerCanonicalPriceBridge } from "@/components/product-launch-flow/ProductLaunchTrackerCanonicalPriceBridge";
import { ProductLaunchTrackerHandoffSync } from "@/components/product-launch-flow/ProductLaunchTrackerHandoffSync";

export default function ProductLaunchFlowPage() {
  return (
    <>
      <PageHeader
        title="상품 출시 플로우"
        description="상품출시진행관리 행번호 또는 체크 선택 상품을 기준으로 샵플링 등록부터 가격·키워드 작업까지 이어갑니다. 마켓 전송은 직접 실행합니다."
      />
      <ProductLaunchTrackerHandoffSync />
      <div className="mb-5">
        <ProductLaunchTrackerCanonicalPriceBridge />
      </div>
      <KeywordRecommendationRerunButton />
      <ProductLaunchAiTitleTermsPanel />
      <ProductLaunchFlowConnected />
    </>
  );
}
