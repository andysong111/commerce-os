import { PageHeader } from "@/components/PageHeader";
import { ProductLaunchFlow } from "@/components/product-launch-flow/ProductLaunchFlow";

export default function LegacyProductLaunchFlowPage() {
  return (
    <>
      <PageHeader
        title="상품 출시 플로우 · 이전 진단 화면"
        description="샵플링 서버 결함 대응 과정에서 사용한 canary, 가격복구, 관리자 화면 확인 로직을 보존한 개발자용 화면입니다. 일반 상품출시는 기본 상품 출시 플로우를 사용하세요."
      />
      <ProductLaunchFlow />
    </>
  );
}
