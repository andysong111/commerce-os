import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { ShoplingPriceAdjustmentInputPreview } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview";
import { ShoplingPriceAdjustmentIndividualBulkEditor } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentIndividualBulkEditor";
import { ShoplingPriceAdjustmentBatchCanaryPanel } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentBatchCanaryPanel";
import { ShoplingPriceAdjustmentPartialRecoveryPanel } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentPartialRecoveryPanel";
import { ShoplingPriceAdjustmentJobResultPanel } from "@/components/shopling-price-adjustment/ShoplingPriceAdjustmentJobResultPanel";
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
        description="상품 목록과 조정률을 입력하고 한 번의 대량 작업으로 실행합니다."
      />
      {loginDisabled ? (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          로그인은 임시 해제 상태입니다. 실행 전 확인과 중복 작업 차단은 그대로 유지됩니다.
        </div>
      ) : null}
      <ShoplingPriceAdjustmentIndividualBulkEditor />
      <div className="price-adjustment-input-simple">
        <ShoplingPriceAdjustmentInputPreview />
      </div>
      <div className="price-adjustment-bulk-simple">
        <ShoplingPriceAdjustmentBatchCanaryPanel />
      </div>
      <ShoplingPriceAdjustmentPartialRecoveryPanel />
      <ShoplingPriceAdjustmentJobResultPanel />
      <style>{`
        .price-adjustment-input-simple > div > section:nth-of-type(2),
        .price-adjustment-input-simple > div > section:nth-of-type(3) {
          display: none;
        }
        .price-adjustment-bulk-simple > section > div:nth-of-type(2) > button:disabled,
        .price-adjustment-bulk-simple > section > div:nth-of-type(2) > button:nth-child(4),
        .price-adjustment-bulk-simple > section > div:nth-of-type(2) > button:nth-child(5) {
          display: none;
        }
        .price-adjustment-bulk-simple > section > div:nth-of-type(2):has(button:nth-child(2):not(:disabled)) > button:nth-child(3) {
          display: none;
        }
        .price-adjustment-bulk-simple > section > p.font-mono {
          display: none;
        }
      `}</style>
    </ShoplingPriceAdjustmentAuthProvider>
  );
}
