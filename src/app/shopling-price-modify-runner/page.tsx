import { PageHeader } from "@/components/PageHeader";
import { ShoplingPriceModifyRunner } from "@/components/shopling-price-modify-runner/ShoplingPriceModifyRunner";

export default function ShoplingPriceModifyRunnerPage() {
  return <><PageHeader title="샵플링 전체 상품 가격 일괄설정" description="카나리 확인 후 goods_key를 안전하게 분할하여 순차 실행합니다." /><ShoplingPriceModifyRunner /></>;
}
