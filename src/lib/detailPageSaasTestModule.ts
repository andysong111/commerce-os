import type { CommerceModule } from "@/lib/moduleRegistry";

export const detailPageSaasTestModule: CommerceModule = {
  id: "detail-page-studio-saas-test",
  title: "Commerce OS Detail Page Studio · SaaS(테스트버전)",
  navigationLabel: "상세페이지 스튜디오 · SaaS(테스트버전)",
  description:
    "상품 이미지와 정보를 입력하면 표준 생성 프로필에 따라 8개 섹션을 만들고, AI 검수·문제 패널 자동보정 후 최종 상세페이지를 제공합니다.",
  status: "available",
  route:
    "https://commerce-os-detail-page-studio.vercel.app/?studio_variant=saas-test",
  category: "detail-page",
  inputType:
    "상품 이미지 최대 3장, 상품명, 공급처 정보, 판매 옵션, 선택형 문구 언어",
  outputType:
    "AI 검수된 8개 섹션 상세페이지, 1000×14000 JPG, 대표 1장·부가 4장, 실행·사용량 원장",
  historySupport: false,
  externalProject: true,
  note: "기존 commerce-os-detail-page-studio Production 엔진과 Standard 프로필을 그대로 사용하되, 1688 링크 입력의 모델명은 선택한 문구 언어로 정규화하는 테스트 모드로 엽니다.",
  helperNote: "SaaS 테스트 · 링크 모델명 현지화",
  actionLabel: "SaaS 테스트 스튜디오 열기",
};
