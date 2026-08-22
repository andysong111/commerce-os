import Link from "next/link";

export default function SeoTitleCloudShoplingRunnerHandoff() {
  return (
    <section className="mx-auto mb-6 max-w-[1500px] px-5 text-slate-900">
      <div className="flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
            REAL SHOPLING REGISTRATION · SEPARATE RUNNER
          </div>
          <div className="mt-1 text-lg font-black text-slate-950">
            SEO 상품명 클라우드 · 샵플링 등록 실행기
          </div>
          <p className="mt-1 text-sm text-slate-600">
            이 클라우드는 상품명·검색어 제조와 재고관리까지만 담당합니다. FINAL 결과를 실제 Shopling에 등록할 때는 별도 실행기로 이동합니다.
          </p>
        </div>
        <Link
          href="/seo-title-cloud-shopling-runner"
          className="shrink-0 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-sm"
        >
          샵플링 등록 실행기 열기
        </Link>
      </div>
    </section>
  );
}
