import { PageHeader } from "@/components/PageHeader";
import { ShoplingProductUploadCanonicalPriceBridge } from "@/components/shopling-product-upload-runner/ShoplingProductUploadCanonicalPriceBridge";
import { ShoplingProductUploadRunner } from "@/components/shopling-product-upload-runner/ShoplingProductUploadRunner";

export default function ShoplingProductUploadRunnerPage() {
  return (
    <>
      <PageHeader
        title="샵플링 상품등록 실행기"
        description="실재고 시트 행 번호를 입력해 상품을 등록한 뒤 동일한 중앙 가격정책 엔진으로 쇼핑몰별 판매가·매입가·소비자가를 자동 정규화합니다."
      />
      <ShoplingProductUploadCanonicalPriceBridge />
      <ShoplingProductUploadRunner />
    </>
  );
}
