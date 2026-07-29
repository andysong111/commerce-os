import { PageHeader } from "@/components/PageHeader";
import { ShoplingPriceAdjustmentInputPreview } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview";

export default function ShoplingPriceAdjustmentRunnerPage() {
  return <>
    <PageHeader
      title="샵플링 판매가 인상·인하 실행기"
      description="goods_key별 인상률·인하율을 대량 입력하고 실행 전 계산계획을 검증합니다."
    />
    <ShoplingPriceAdjustmentInputPreview />
  </>;
}
