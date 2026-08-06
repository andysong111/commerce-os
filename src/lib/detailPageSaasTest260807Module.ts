import type { CommerceModule } from "@/lib/moduleRegistry";

export const detailPageSaasTest260807Module: CommerceModule = {
  id: "detail-page-studio-saas-test-260807",
  title: "Commerce OS Detail Page Studio · SaaS(테스트버전260807)",
  navigationLabel: "상세페이지 스튜디오 · SaaS(테스트버전260807)",
  description:
    "현재 SaaS 테스트버전의 2026-08-07 스냅샷입니다. 상품 이미지와 정보를 입력하면 표준 생성 프로필에 따라 8개 섹션을 만들고, AI 검수·문제 패널 자동보정 후 최종 상세페이지를 제공합니다.",
  status: "available",
  route:
    "https://commerce-os-detail-page-studio-git-saas-test-260807-a2bsangsa.vercel.app/?studio_variant=saas-test",
  category: "detail-page",
  inputType:
    "상품 이미지 최대 3장, 상품명, 공급처 정보, 판매 옵션, 선택형 문구 언어",
  outputType:
    "AI 검수된 8개 섹션 상세페이지, 1000×14000 JPG, 대표 1장·부가 4장, 실행·사용량 원장",
  historySupport: false,
  externalProject: true,
  note: "commerce-os-detail-page-studio의 saas-test-260807 스냅샷 코드 라인을 사용합니다. 기존 SaaS 전용 및 기존 SaaS 테스트버전과 분리해 이후 보완 작업을 진행하는 기준 버전입니다.",
  helperNote: "2026-08-07 스냅샷 · 독립 보완선",
  actionLabel: "SaaS 테스트260807 열기",
};
