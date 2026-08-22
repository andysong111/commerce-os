import Link from "next/link";

import SeoFinalShoplingUploadPanel from "@/app/keyword-engine-elon-lab/SeoFinalShoplingUploadPanel";

export default function SeoTitleCloudShoplingRunnerPage() {
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 px-5 py-8 text-slate-900">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              COMMERCE OS · REAL SHOPLING REGISTRATION
            </p>
            <h1 className="mt-2 text-3xl font-black">
              SEO 상품명 클라우드 · 샵플링 등록 실행기
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              SEO 대량등록 클라우드에서 확정한 상품명과 검색어 10개를 실제 Shopling 등록 단계로 넘기는 전용 실행기입니다.
              카테고리·가격·옵션·바코드·상세페이지·이미지는 상품출시 진행관리 데이터를 그대로 재사용합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/keyword-engine-elon-lab"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black"
            >
              SEO 대량등록 클라우드
            </Link>
            <Link
              href="/product-launch-tracker"
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white"
            >
              상품출시 진행관리
            </Link>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          이 화면은 실제 외부 등록 전용입니다. SEO 상품명 제조·재고 생성은 SEO 대량등록 클라우드에서 수행하고,
          이 실행기는 확정값 저장·중복 검사·기존 Shopling 6채널 업로드 엔진 호출만 담당합니다.
        </div>
      </header>

      <SeoFinalShoplingUploadPanel />
    </main>
  );
}
