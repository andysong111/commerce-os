import type { ReactNode } from "react";
import { ChinaOrderManagerNav } from "@/components/china-order-manager/ChinaOrderManagerNav";
import { FinalizedPurchaseRecommendationBanner } from "@/components/china-order-manager/FinalizedPurchaseRecommendationBanner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ChinaOrderManagerLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <ChinaOrderManagerNav />
      <FinalizedPurchaseRecommendationBanner />
      {children}
    </>
  );
}
