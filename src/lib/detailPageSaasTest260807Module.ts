import type { CommerceModule } from "@/lib/moduleRegistry";

export const detailPageSaasTest260807Module: CommerceModule = {
  id: "detail-page-studio-saas-test-260807",
  title: "Commerce OS Detail Page Studio · SaaS(테스트버전) · v260807",
  navigationLabel: "상세페이지 스튜디오 · SaaS(테스트버전)",
  description:
    "SaaS 테스트버전에서 검증된 동일 엔진 기준을 자유로운 수정·실험용 독립 개발선으로 복제했습니다. 상품 이미지와 정보를 입력하면 표준 생성 프로필에 따라 8개 섹션을 만들고, AI 검수·문제 패널 자동보정 후 최종 상세페이지를 제공합니다.",
  status: "available",
  route:
    "https://commerce-os-detail-page-studio-git-isolated-saas-test-a2bsangsa.vercel.app/?studio_variant=saas-test",
  category: "detail-page",
  inputType:
    "상품 이미지 최대 3장, 상품명, 공급처 정보, 판매 옵션, 선택형 문구 언어",
  outputType:
    "AI 검수된 8개 섹션 상세페이지, 대표 1장·부가 4장, 실행·사용량 원장",
  historySupport: false,
  externalProject: true,
  note: "기준 버전 v260807. commerce-os-detail-page-studio의 isolated/saas-test 개발선만 사용합니다. OPS Center 전용·SaaS 전용 엔진 수정은 이 카드에 자동 반영하지 않습니다.",
  helperNote: "v260807 · SaaS 테스트 · 독립 엔진",
  actionLabel: "SaaS 테스트 스튜디오 열기",
};
