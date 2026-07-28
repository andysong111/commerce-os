import { PageHeader } from "@/components/PageHeader";
import { ShoplingPriceModifySimpleAutoRunner } from "@/components/shopling-price-modify-runner/ShoplingPriceModifySimpleAutoRunner";

export default function ShoplingPriceModifyRunnerPage() {
  return <>
    <PageHeader
      title="샵플링 전체 가격 자동 변경"
      description="상품번호를 넣고 버튼 한 번만 누르면 첫 10개 확인 후 나머지를 자동으로 변경합니다."
    />
    <ShoplingPriceModifySimpleAutoRunner />
  </>;
}
