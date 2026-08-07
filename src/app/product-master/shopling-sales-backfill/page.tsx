import Link from "next/link";
import { ShoplingSalesBackfillControl } from "@/app/product-master/shopling-sales-backfill/ShoplingSalesBackfillControl";
import { PageHeader } from "@/components/PageHeader";
import { loadProductMasterShoplingSalesStatus } from "@/lib/productMasterShoplingSalesBackfill";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductMasterShoplingSalesBackfillPage() {
  const status = await loadProductMasterShoplingSalesStatus();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 상품마스터 판매원장"
        title="Shopling 최근 24개월 판매원장 적재"
        description="현재 확정된 Shopling 연결값을 기준으로 주문을 위치코드·기본 재고수량으로 환산합니다. 먼저 읽기 전용 전수수집을 완료하고, 미연결·중복이 없을 때만 1건 카나리와 전수 적재를 허용합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/product-master/shopling-diagnostic/apply"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Shopling 연결값
            </Link>
            <Link
              href="/product-master/shopling-sales-incremental"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              증분 자동동기화
            </Link>
            <Link
              href="/product-master"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              상품마스터 구축현황
            </Link>
          </div>
        }
      />
      <ShoplingSalesBackfillControl initialStatus={status} />
    </div>
  );
}
