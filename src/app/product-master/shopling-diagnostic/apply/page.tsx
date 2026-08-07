import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ShoplingMappingApplyControl } from "@/app/product-master/shopling-diagnostic/apply/ShoplingMappingApplyControl";
import { loadProductMasterShoplingMappingApplyStatus } from "@/lib/productMasterShoplingMappingApply";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductMasterShoplingMappingApplyPage() {
  const status = await loadProductMasterShoplingMappingApplyStatus();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 상품마스터 연결 적용"
        title="Shopling 연결값 안전 적용"
        description="전수진단에서 확인한 위치코드·goods_key·옵션 ID·세트 환산수량을 현재 상품마스터와 다시 대조한 뒤 1건 카나리와 전수 재검증을 거쳐 저장합니다. Shopling 자체 상품·가격·재고·발주는 변경하지 않습니다."
        actions={
          <div className="flex flex-wrap gap-2">
            {status.state === "COMPLETED" ? (
              <Link
                href="/product-master/shopling-sales-backfill"
                className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-emerald-700"
              >
                최근 24개월 판매원장
              </Link>
            ) : null}
            <Link
              href="/product-master/shopling-diagnostic"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              전수진단으로 돌아가기
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
      <ShoplingMappingApplyControl initialStatus={status} />
    </div>
  );
}
