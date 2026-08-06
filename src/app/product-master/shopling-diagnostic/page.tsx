import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ShoplingDiagnosticControl } from "@/app/product-master/shopling-diagnostic/ShoplingDiagnosticControl";
import { loadProductMasterShoplingDiagnosticStatus } from "@/lib/productMasterShoplingDiagnostic";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductMasterShoplingDiagnosticPage() {
  const status = await loadProductMasterShoplingDiagnosticStatus();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 상품마스터 전수진단"
        title="Shopling 연결·세트수량 진단"
        description="현재 상품마스터 SKU와 실제 Shopling 상품·옵션을 읽기 전용으로 대조합니다. 바코드 연결 후보와 1+1·N개입 판매의 재고 환산수량을 계산하지만 실제 값은 변경하지 않습니다."
        actions={
          <Link
            href="/product-master"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            상품마스터 구축현황
          </Link>
        }
      />
      <ShoplingDiagnosticControl initialStatus={status} />
    </div>
  );
}
