import type { CommerceModule } from "@/lib/moduleRegistry";

export const detailPageSaasTestModule: CommerceModule = {
  id: "detail-page-studio-saas-test",
  title: "Commerce OS Detail Page Studio · SaaS(테스트버전)",
  navigationLabel: "상세페이지 스튜디오 · SaaS(테스트버전)",
  description:
    "상품 이미지와 정보를 입력하면 표준 생성 프로필에 따라 8개 섹션을 만들고, AI 검수·문제 패널 자동보정 후 최종 상세페이지를 제공합니다.",
  status: "available",
  route: "https://commerce-os-detail-page-studio.vercel.app/",
  category: "detail-page",
  inputType:
    "상품 이미지 최대 3장, 상품명, 공급처 정보, 판매 옵션, 선택형 문구 언어",
  outputType:
    "AI 검수된 8개 섹션 상세페이지, 1000×14000 JPG, 대표 1장·부가 4장, 실행·사용량 원장",
  historySupport: false,
  externalProject: true,
  note: "commerce-os-detail-page-studio Production을 최신 운영 기준으로 사용합니다. 기본 Standard 프로필, 다국어 로케일, 실행·사용량 원장이 포함됩니다.",
  helperNote: "최신 운영 버전 · 사용 가능",
  actionLabel: "SaaS 상세페이지 스튜디오 열기",
};
