import Link from "next/link";
import { FreightMonthlyOrderContextBridge } from "@/components/freight-barcode-request/FreightMonthlyOrderContextBridge";
import { PageHeader } from "@/components/PageHeader";
import { loadInternalChinaMonthlyPurchaseSummary } from "@/lib/internalChinaMonthlyPurchaseSummary";
import type { FreightMonthlyOrderContext } from "@/lib/freightMonthlyOrderContext";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams: Promise<{ month?: string | string[] }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function FreightBarcodeMonthlyBridgePage({
  searchParams,
}: PageProps) {
  const month = firstParam((await searchParams).month);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="COMMERCE OS · MONTHLY FREIGHT BARCODE"
          title="발주월을 확인할 수 없습니다"
          description="월별 발주·입고 관리 화면에서 배송대행지 바코드 출력 버튼으로 다시 들어와주세요."
        />
        <Link
          href="/china-order-manager"
          className="inline-flex rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white"
        >
          월별 발주·입고 관리로 이동
        </Link>
      </div>
    );
  }

  const summary = await loadInternalChinaMonthlyPurchaseSummary(month).catch(
    () => null,
  );
  const lines = (summary?.lines ?? [])
    .filter((line) => line.assigned)
    .map((line) => ({
      barcode: line.barcode,
      modelNo: line.modelNo,
      modelName: line.modelName,
      saleOption: line.saleOption,
      chinaOption: line.chinaOption,
      orderNumber: line.orderNumber,
      supplierLink: line.supplierLink,
      quantity: line.quantity,
    }));

  if (!summary || !lines.length) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="COMMERCE OS · MONTHLY FREIGHT BARCODE"
          title={`${month} 배송대행지 바코드 연결 대기`}
          description="선택한 월에 B-code가 연결된 실제 1688 주문 품목이 아직 없습니다."
        />
        <Link
          href={`/china-order-manager?month=${encodeURIComponent(month)}`}
          className="inline-flex rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white"
        >
          월별 발주·입고 관리로 돌아가기
        </Link>
      </div>
    );
  }

  const context: FreightMonthlyOrderContext = {
    cycleMonth: month,
    orderCount: summary.orderCount,
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    savedAt: Date.now(),
    lines,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="COMMERCE OS · MONTHLY FREIGHT BARCODE"
        title={`${month} 배송대행지 바코드 출력 연결`}
        description="해당 월 실제 1688 주문품의 주문번호·B-code·모델·옵션을 바코드 출력기에 전달합니다."
      />
      <FreightMonthlyOrderContextBridge context={context} />
    </div>
  );
}
