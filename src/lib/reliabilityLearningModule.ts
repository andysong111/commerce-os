import type { CommerceModule } from "@/lib/moduleRegistry";

export const reliabilityLearningModule: CommerceModule = {
  id: "reliability-learning-core",
  title: "Commerce OS 통합 신뢰성·자기개선 코어",
  navigationLabel: "신뢰성·자기개선 코어",
  description:
    "Commerce OS와 AI-Saurus의 실행 결과·오류·품질·복구 신호를 자동 수집하고, 반복 사건을 학습 후보·회귀 테스트·안전한 복구 작업으로 전환합니다.",
  status: "available",
  route: "/reliability",
  category: "운영 자동화",
  inputType:
    "기능별 실행 상태, 오류 코드, 품질 수치, 비용·재시도·복구 결과의 개인정보 최소화 이벤트",
  outputType:
    "중복 사건 집계, 자동복구 큐, 학습 자산 후보, 영구 회귀 테스트 제안, 시스템별 품질 추세",
  historySupport: true,
  externalProject: false,
  note:
    "원문 고객 입력·이메일·이미지는 기본 저장하지 않습니다. 가격·재고·주문·권한·DB 구조 변경은 자동 반영하지 않고 승인 대상으로 격리합니다.",
  helperNote: "자동 수집 · 반복 오류 자산화",
  actionLabel: "자기개선 통제실 열기",
  safetyBadge: "고위험 자동수정 차단",
};
