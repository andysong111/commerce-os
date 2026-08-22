import type { CommerceModule } from "@/lib/moduleRegistry";

export const keywordEngineElonLabModule: CommerceModule = {
  id: "keyword-engine-elon-lab",
  title: "SEO 대량등록 클라우드",
  navigationLabel: "SEO 대량등록 클라우드",
  description:
    "1688 중국 원본 링크 하나에서 상품 정체성·모델명·검색어를 확정하고, API HUB 지식iN·카페·블로그·웹문서 Evidence Market Mine과 SearchAd·Search Trend 검증을 거친 뒤 도매·소매 SEO 전략에 맞춘 중복 없는 쇼핑몰별 상품명을 대량 제조해 Supabase 클라우드 재고로 축적합니다.",
  status: "available",
  route: "/keyword-engine-elon-lab",
  category: "상품 등록 자동화",
  inputType: "1688 중국 상품 링크, 상품출시 진행관리 연결상품",
  outputType: "링크 기반 모델명, 공통 검색어 10개, 50bytes 이하 쇼핑몰별 상품명 재고, 잔여 등록 가능 회차",
  historySupport: true,
  externalProject: false,
  note:
    "기존 V6 Evidence Market Mine·Search Trend 검증 계약을 유지하면서 내부적으로 영구 상품명 원장·재고 구조를 추가합니다. STEP 1~4 검증 결과를 바탕으로 한 번 사용하거나 예약된 제목을 재발급하지 않으며, 실제 Shopling 전송은 별도 샵플링 SEO 출고센터에서만 수행합니다.",
  helperNote: "1688 링크 → 모델명·검색어 확정 → 고유 상품명 대량 제조 → 클라우드 재고 축적",
  actionLabel: "SEO 대량등록 클라우드 열기",
  safetyBadge: "제조·재고관리 / 외부전송 분리",
};
