import type { ReactNode } from "react";
import { ChinaOrderManagerNav } from "@/components/china-order-manager/ChinaOrderManagerNav";

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
      {children}
    </>
  );
}
