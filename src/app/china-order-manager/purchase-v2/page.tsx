import { PurchaseV2Workspace } from "@/components/china-order-manager/PurchaseV2Workspace";
import { loadInventoryLifecycleSnapshot } from "@/lib/inventoryLifecycleLedger";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { loadFinalizedPurchaseRecommendationV2 } from "@/lib/purchaseRecommendationFinalization";
import { loadPurchaseRecommendationV2 } from "@/lib/purchaseRecommendationV2";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

export default async function PurchaseV2Page() {
  const cycleMonth = seoulCalendarMonth(new Date());
  const [report, finalized, lifecycle] = await Promise.all([
    loadPurchaseRecommendationV2(),
    loadFinalizedPurchaseRecommendationV2(cycleMonth).catch(() => null),
    loadInventoryLifecycleSnapshot(),
  ]);

  return (
    <PurchaseV2Workspace
      initialReport={report}
      initialFinalized={finalized}
      initialLifecycle={lifecycle}
    />
  );
}
