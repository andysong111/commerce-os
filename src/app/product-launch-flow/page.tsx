import { PageHeader } from "@/components/PageHeader";
import { ProductLaunchFlowSimple } from "@/components/product-launch-flow/ProductLaunchFlowSimple";

export default function ProductLaunchFlowPage() {
  return (
    <>
      <PageHeader
        title="상품 출시 플로우"
        description="실재고 행번호를 기준으로 상품업로드, 위치코드·바코드 등록, 가격설정, 검색어와 쇼핑몰별 상품명 반영까지 한 흐름으로 진행합니다. 마켓 전송은 직접 실행합니다."
      />
      <ProductLaunchFlowSimple />
    </>
  );
}
