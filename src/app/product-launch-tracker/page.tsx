export default function ProductLaunchTrackerPage() {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <iframe
        title="신규 상품 출시 진행관리"
        src="/product-launch-tracker-app/index.html"
        className="h-[calc(100vh-5rem)] min-h-[760px] w-full border-0"
      />
    </section>
  );
}
