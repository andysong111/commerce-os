import type { ReactNode } from "react";
import { MonthlyForwarderBarcodeFlowInjector } from "@/components/china-order-manager/MonthlyForwarderBarcodeFlowInjector";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ChinaOrderManagerLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      {children}
      <MonthlyForwarderBarcodeFlowInjector />
    </>
  );
}
