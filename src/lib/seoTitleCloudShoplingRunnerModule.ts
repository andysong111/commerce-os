import type { CommerceModule } from "@/lib/moduleRegistry";

export const seoTitleCloudShoplingRunnerModule: CommerceModule = {
  id: "seo-title-cloud-shopling-runner",
  title: "SEO 상품명 클라우드 · 샵플링 등록 실행기",
  navigationLabel: "SEO 상품명 클라우드 · 샵플링 등록 실행기",
  description:
    "SEO 대량등록 클라우드에서 확정한 상품명과 공통 검색어 10개를 상품출시 진행관리의 카테고리·가격·옵션·바코드·상세페이지·이미지와 결합해 기존 Shopling 6채널 실제 등록 엔진을 실행합니다.",
  status: "available",
  route: "/seo-title-cloud-shopling-runner",
  category: "상품 등록 자동화",
  inputType:
    "SEO FINAL 상품명 6개, 검색어 10개, 상품출시 진행관리 연결상품",
  outputType:
    "도매1~도매4·소매1~소매2 Shopling 실제 등록, 채널별 goods_key, 등록 결과",
  historySupport: true,
  externalProject: false,
  note:
    "이 카드는 SEO 상품명 제조 기능을 복제하지 않습니다. SEO 대량등록 클라우드의 확정값과 기존 shopling-product-upload-auto 실행 엔진을 재사용하며, 실제 등록 직전 중복 goods_key를 검사하고 사용자 확인을 거칩니다.",
  helperNote: "SEO 확정값 → 기존 Shopling 6채널 등록 엔진 실행",
  actionLabel: "샵플링 등록 실행기 열기",
  safetyBadge: "중복 차단 · 실제 등록 전 확인",
};
