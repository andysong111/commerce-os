import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { ShoplingPriceAdjustmentInputPreview } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview";
import { ShoplingPriceAdjustmentIndividualBulkEditor } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentIndividualBulkEditor";
import { ShoplingPriceAdjustmentUnifiedCanaryPanel } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentUnifiedCanaryPanel";
import { ShoplingPriceAdjustmentBatchCanaryPanel } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentBatchCanaryPanel";
import { getOpsCurrentUser } from "@/lib/supabase/currentUser";

export const dynamic = "force-dynamic";

export default async function ShoplingPriceAdjustmentRunnerPage() {
  const { user } = await getOpsCurrentUser();
  if (!user) {
    redirect(
      "/login?error=login_required&next=%2Fshopling-price-adjustment-runner",
    );
  }

  return <>
    <PageHeader
      title="샵플링 판매가 인상·인하 실행기"
      description="goods_key별 인상률·인하율을 대량 입력하고 실행 전 계산계획을 검증합니다."
    />
    <ShoplingPriceAdjustmentIndividualBulkEditor />
    <div className="price-adjustment-input-with-unified-single">
      <ShoplingPriceAdjustmentInputPreview />
    </div>
    <ShoplingPriceAdjustmentUnifiedCanaryPanel />
    <ShoplingPriceAdjustmentBatchCanaryPanel />
    <style>{`.price-adjustment-input-with-unified-single > div > section:nth-of-type(3) { display: none; }`}</style>
  </>;
}
