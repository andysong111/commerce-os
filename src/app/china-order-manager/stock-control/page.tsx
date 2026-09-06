import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function InventoryStockControlPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE"
        title="재고·품절·재입고 동기화"
        description="B코드 품절을 실제로 확인한 순간 재고를 0으로 초기화합니다. 이후 확정입고와 Canonical 판매로 Commerce OS 정확재고를 이어가며, Shopling/마켓에는 재고수량이 아니라 품절·판매중 상태만 전송합니다."
        actions={
          <Link
            href="/api/shopling-stock-state-sync/download"
            className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800"
          >
            Shopling 재고상태 확장 v0.1.3 다운로드
          </Link>
        }
      />
      <InventoryStockControlPanel />
    </div>
  );
}
