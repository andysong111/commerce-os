import type { CommerceModule } from "@/lib/moduleRegistry";

export const detailPageTestStudioModule: CommerceModule = {
  id: "detail-page-studio-test",
  title: "상세페이지 스튜디오 테스트버전",
  navigationLabel: "상세페이지 스튜디오 테스트버전",
  description:
    "1688 링크 또는 제품 이미지 3장을 직접 입력해 새 상세페이지 엔진용 작업을 등록하고, 기존 상세페이지 AI 작업 검수 원장에서 진행상태를 추적합니다.",
  status: "check_mode",
  route: "/detail-page-studio-test",
  category: "detail-page",
  inputType:
    "1688 상품 상세주소 또는 제품 이미지 3장, 상품명, 공급처 정보, 실제 판매 옵션, 문구 언어",
  outputType:
    "테스트 엔진 전용 상세페이지 작업, 입력 원본 저장, 상세페이지 AI 작업 검수 원장",
  historySupport: true,
  externalProject: false,
  note: "new-product-detail-ai 독립 레포의 입력 UI를 Ops Center 안에서 열고, 등록 결과는 기존 상세페이지 작업 원장에 저장합니다. 전용 테스트 Worker 연결 전에는 기존 운영 엔진이 처리하지 않습니다.",
  helperNote: "TEST · 새 엔진 입력",
  actionLabel: "테스트 스튜디오 열기",
  safetyBadge: "기존 운영 엔진과 분리",
};
