import { ProductMasterSyncButton } from "@/components/product-launch-flow/ProductMasterSyncButton";

export default async function ProductLaunchTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ detailPageItem?: string | string[] }>;
}) {
  const resolved = await searchParams;
  const itemId = Array.isArray(resolved.detailPageItem)
    ? resolved.detailPageItem[0]
    : resolved.detailPageItem;
  const iframeParams = new URLSearchParams({ detail_page_mode: "client" });
  if (itemId) iframeParams.set("open_item", itemId.slice(0, 160));

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <strong className="block text-sm text-slate-950">
            상품마스터 기준정보 동기화
          </strong>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            저장된 출시상품·옵션 바코드·샵플링 goods_key와 최근 확정 입고원가를 독립 상품마스터로 보냅니다.
          </span>
        </div>
        <ProductMasterSyncButton />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <iframe
          title="신규 상품 출시 진행관리"
          src={`/product-launch-tracker-app/index.html?${iframeParams.toString()}`}
          className="h-[calc(100vh-10rem)] min-h-[720px] w-full border-0"
        />
      </div>
    </section>
  );
}
