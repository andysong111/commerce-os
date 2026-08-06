import type { CommerceModule } from "@/lib/moduleRegistry";

export const detailPageSaasTest260807Module: CommerceModule = {
  id: "detail-page-studio-saas-test-260807",
  title: "Commerce OS Detail Page Studio · SaaS(테스트버전260807)",
  navigationLabel: "상세페이지 스튜디오 · SaaS(테스트버전260807)",
  description:
    "현재 SaaS 테스트버전의 2026-08-07 기준 복제본입니다. 상품 이미지와 정보를 입력하면 표준 생성 프로필에 따라 8개 섹션을 만들고, AI 검수·문제 패널 자동보정 후 최종 상세페이지를 제공합니다.",
  status: "available",
  route:
    "https://commerce-os-detail-page-studio.vercel.app/?studio_variant=saas-test-260807",
  category: "detail-page",
  inputType:
    "상품 이미지 최대 3장, 상품명, 공급처 정보, 판매 옵션, 선택형 문구 언어",
  outputType:
    "AI 검수된 8개 섹션 상세페이지, 1000×14000 JPG, 대표 1장·부가 4장, 실행·사용량 원장",
  historySupport: false,
  externalProject: true,
  note: "운영 Studio에서 saas-test-260807 전용 모드로 실행합니다. 소스 기준점은 commerce-os-detail-page-studio의 saas-test-260807 스냅샷 브랜치에 고정되어 있으며, 기존 SaaS 전용·기존 SaaS 테스트버전과 구분해 이후 보완합니다.",
  helperNote: "260807 복제본 · 독립 보완선",
  actionLabel: "SaaS 테스트260807 열기",
};
