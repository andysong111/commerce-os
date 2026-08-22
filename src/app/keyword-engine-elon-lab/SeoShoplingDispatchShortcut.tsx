import Link from "next/link";

export default function SeoShoplingDispatchShortcut() {
  return (
    <section className="mx-auto mb-6 max-w-[1500px] px-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-black text-emerald-950">상품명 재고 저장 다음 단계</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-emerald-800">
            전체몰 1회분이 준비되면 샵플링 SEO 출고센터에서 상품 6개와 쇼핑몰별 상품명 29개·공통 검색어 10개를 실제 등록합니다.
          </div>
        </div>
        <Link
          href="/shopling-seo-dispatch"
          className="shrink-0 rounded-xl bg-emerald-700 px-5 py-3 text-center text-sm font-black text-white"
        >
          샵플링 실제등록 출고센터
        </Link>
      </div>
    </section>
  );
}
