import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. v0.3.2는 가격조정 확장의 all-frame 작업엔진을 유지하면서 A6에서 실제 옵션상태 드롭다운 하나에 판매중/품절을 직접 선택하고 일괄 상태변경을 실행하도록 수정합니다. 로그인된 관리자 메인 탭 하나만 열어두면 A4/A6/A21 작업창을 자동 생성하고 2024-01-01부터 실행 당일까지 검색합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.3.2 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
