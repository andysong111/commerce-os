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
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <iframe
        title="신규 상품 출시 진행관리"
        src={`/product-launch-tracker-app/index.html?${iframeParams.toString()}`}
        className="h-[calc(100vh-5rem)] min-h-[760px] w-full border-0"
      />
    </section>
  );
}
