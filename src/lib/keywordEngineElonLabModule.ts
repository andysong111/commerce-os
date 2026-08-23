import type { CommerceModule } from "@/lib/moduleRegistry";

export const keywordEngineElonLabModule: CommerceModule = {
  id: "keyword-engine-elon-lab",
  title: "SEO 대량등록 클라우드",
  navigationLabel: "SEO 대량등록 클라우드",
  description:
    "상품출시 진행관리에서 여러 상품을 선택해 STEP 1~4 SEO 분석과 FINAL 검색어·쇼핑몰별 상품명을 병렬 생성하고, 준비된 상품을 한 번에 Shopling에 대량 등록합니다.",
  status: "available",
  route: "/seo-bulk-cloud",
  category: "상품 등록 자동화",
  inputType: "상품출시 진행관리에서 선택한 1~50개 상품, 1688 중국 상품 링크",
  outputType:
    "상품별 FINAL 검색어 10개, 도매·소매 기준 상품명 6개, 쇼핑몰별 상품명 29개, Shopling 일괄등록 결과",
  historySupport: true,
  externalProject: false,
  note:
    "기본 운영 화면은 FINAL RESULT와 Shopling 일괄등록만 노출합니다. 기존 STEP 1~5·Evidence Market Mine·Search Trend·원장·진단 화면은 고급 상세에서만 펼칩니다. 생성은 최대 3개 상품씩 병렬 실행하고 각 상품 결과를 상품출시 진행관리에 즉시 저장합니다.",
  helperNote:
    "여러 상품 선택 → 병렬 FINAL RESULT 생성 → 상품별 검색어 확인 → Shopling 일괄 대량등록",
  actionLabel: "SEO 대량등록 클라우드 열기",
  safetyBadge: "병렬 3개 · 기존 중복 goods_key 차단 유지",
};
