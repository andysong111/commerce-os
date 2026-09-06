import Link from "next/link";
import { InventoryStockControlPanel } from "@/components/china-order-manager/InventoryStockControlPanel";
import { PageHeader } from "@/components/PageHeader";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default function InventoryStockControlPage() {
  return <div className="space-y-5">
    <PageHeader eyebrow="COMMERCE OS · EXACT INVENTORY · SHOPLING STOCK STATE" title="재고·품절·재입고 동기화"
      description="재고수량은 Commerce OS에서 관리하고 Shopling/마켓에는 품절·판매중 상태만 전송합니다. v0.2.3.1: 로그인 완료된 Shopling 관리자 메인 탭 하나만 열어두세요. 필요한 A4/A6/A21 작업창을 자동 생성하고 2024-01-01부터 실행 당일까지 검색합니다. A6가 레거시 분리 프레임으로 열려도 검색 컨트롤 프레임을 안전하게 A6로 인식합니다."
      actions={<Link href="/api/shopling-stock-state-sync/download" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Shopling 재고상태 확장 v0.2.3.1 다운로드</Link>} />
    <InventoryStockControlPanel />
  </div>;
}
