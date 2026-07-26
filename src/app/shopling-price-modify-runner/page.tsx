import { PageHeader } from "@/components/PageHeader";
import { ShoplingPriceModifyRunner } from "@/components/shopling-price-modify-runner/ShoplingPriceModifyRunner";
import { ShoplingPriceModifyBulkInputPreview } from "@/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview";

export default function ShoplingPriceModifyRunnerPage() {
  return <><PageHeader title="샵플링 쇼핑몰별 가격설정 실행기" description="goods_key 기준으로 쇼핑몰별 가격설정을 준비합니다." /><div className="space-y-8"><ShoplingPriceModifyBulkInputPreview /><details className="rounded-2xl border bg-white p-6"><summary className="cursor-pointer text-xl font-bold">고급: 50개 이하 즉시 실행</summary><p className="my-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">이 기능은 기존 50개 이하 즉시 실행 기능입니다.<br />대량 목록은 위의 Bulk 준비 작업을 사용하세요.</p><ShoplingPriceModifyRunner /></details></div></>;
}
