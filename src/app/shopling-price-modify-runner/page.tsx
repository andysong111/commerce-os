import { PageHeader } from "@/components/PageHeader";
import { ShoplingPriceModifyBulkRunner } from "@/components/shopling-price-modify-runner/ShoplingPriceModifyBulkRunner";

export default function ShoplingPriceModifyRunnerPage() {
  return <><PageHeader title="샵플링 전체 상품 가격 일괄설정" description="엑셀·CSV 또는 goods_key 붙여넣기로 대량 가격설정 작업을 생성합니다. 실행 후 브라우저와 컴퓨터를 꺼도 서버에서 계속 진행됩니다." /><ShoplingPriceModifyBulkRunner /></>;
}
