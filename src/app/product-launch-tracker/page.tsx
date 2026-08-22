import { ProductMasterSyncButton } from "@/components/product-launch-flow/ProductMasterSyncButton";

const PRODUCT_LAUNCH_ASSET_VERSION =
  "20260815-bidirectional-purchase-metadata-v1-seo-bulk-cloud-v3-perf";

export default async function ProductLaunchTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ detailPageItem?: string | string[] }>;
}) {
  const resolved = await searchParams;
  const itemId = Array.isArray(resolved.detailPageItem)
    ? resolved.detailPageItem[0]
    : resolved.detailPageItem;
  const iframeParams = new URLSearchParams({
    detail_page_mode: "client",
    asset_version: PRODUCT_LAUNCH_ASSET_VERSION,
  });
  if (itemId) iframeParams.set("open_item", itemId.slice(0, 160));

  return (
    <section className="space-y-3">
      <section className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900 shadow-sm">
        <strong className="block text-sm">백그라운드 자동화 · 상품마스터와 분리 운영</strong>
        <span className="mt-1 block text-xs leading-5">
          중앙 가격정책과 상세페이지 오류 판정은 등록·생성 서버 후처리에서 실행됩니다. 상품마스터 화면은 이를 확인하기 위해 전체 출시원장을 주기적으로 반복 조회하지 않습니다.
        </span>
        <span className="mt-1 block text-xs opacity-80">
          상품마스터 조회와 자동화 실행을 분리해 한쪽의 지연이 다른 쪽의 화면 사용을 막지 않도록 운영합니다.
        </span>
      </section>

      <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <strong className="block text-sm text-violet-950">SEO 대량등록 클라우드 연결</strong>
          <span className="mt-1 block text-xs leading-5 text-violet-800">
            목록에서 상품 한 개를 선택한 뒤 ‘선택 상품 SEO 대량등록 클라우드 열기’를 누르면 저장된 1688 링크를 불러와 고유 상품명 재고를 제조하거나 기존 클라우드 재고를 확인합니다.
          </span>
        </div>
        <a href="/shopling-seo-dispatch" className="rounded-lg bg-violet-700 px-4 py-2 text-center text-sm font-black text-white">
          샵플링 SEO 출고센터
        </a>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <strong className="block text-sm text-slate-950">상품마스터 기준정보 동기화</strong>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            저장된 출시상품·옵션 바코드·샵플링 goods_key와 최근 확정 입고원가를 독립 상품마스터로 보냅니다.
          </span>
        </div>
        <ProductMasterSyncButton />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <iframe
          title="상품마스터 · 출시관리"
          src={`/product-launch-tracker-app/index.html?${iframeParams.toString()}`}
          allow="local-network; loopback-network; local-network-access"
          className="h-[calc(100vh-10rem)] min-h-[720px] w-full border-0"
        />
      </div>
    </section>
  );
}
