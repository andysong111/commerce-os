import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { ShoplingPriceAdjustmentInputPreview } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview";
import { ShoplingPriceAdjustmentIndividualBulkEditor } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentIndividualBulkEditor";
import { ShoplingPriceAdjustmentUnifiedCanaryPanel } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentUnifiedCanaryPanel";
import { ShoplingPriceAdjustmentBatchCanaryPanel } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentBatchCanaryPanel";
import { ShoplingPriceAdjustmentPartialRecoveryPanel } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentPartialRecoveryPanel";
import { ShoplingPriceAdjustmentAuthProvider } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentAuthProvider";
import { isOpsLoginTemporarilyDisabled } from "@/lib/opsLoginBypass";
import { isShoplingPriceAdjustmentOperatorEmail } from "@/lib/shoplingPriceAdjustmentAuth";
import { getOpsCurrentUser } from "@/lib/supabase/currentUser";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ShoplingPriceAdjustmentRunnerPage() {
  const loginDisabled = isOpsLoginTemporarilyDisabled();
  let accessToken: string | null = null;

  if (!loginDisabled) {
    const current = await getOpsCurrentUser();
    if (!current.user) {
      redirect(
        "/login?error=login_required&next=%2Fshopling-price-adjustment-runner",
      );
    }
    if (!isShoplingPriceAdjustmentOperatorEmail(current.user.email)) {
      redirect("/");
    }
    accessToken = current.accessToken;
  }

  return (
    <ShoplingPriceAdjustmentAuthProvider accessToken={accessToken}>
      <PageHeader
        title="샵플링 판매가 인상·인하 실행기"
        description="goods_key별 인상률·인하율을 대량 입력하고 실행 전 계산계획을 검증합니다."
      />
      {loginDisabled ? (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          로그인은 임시 해제 상태입니다. 최종 확인·10개 시험 실행·중복 작업
          차단은 그대로 유지됩니다.
        </div>
      ) : null}
      <ShoplingPriceAdjustmentIndividualBulkEditor />
      <div className="price-adjustment-input-with-unified-single">
        <ShoplingPriceAdjustmentInputPreview />
      </div>
      <ShoplingPriceAdjustmentUnifiedCanaryPanel />
      <ShoplingPriceAdjustmentBatchCanaryPanel />
      <ShoplingPriceAdjustmentPartialRecoveryPanel />
      <style>{`.price-adjustment-input-with-unified-single > div > section:nth-of-type(3) { display: none; }`}</style>
    </ShoplingPriceAdjustmentAuthProvider>
  );
}
