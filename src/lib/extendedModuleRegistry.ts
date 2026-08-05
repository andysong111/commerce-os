import { moduleRegistry, type CommerceModule } from "@/lib/moduleRegistry";

export const commerceOperationsModule: CommerceModule = {
  id: "commerce-operations-safety",
  title: "운영 안전센터",
  navigationLabel: "운영 안전센터",
  description:
    "입고확정 이후 자동화, 데이터 최신도, 최종 승인 대기, 실패·반영 불확실 작업을 한곳에서 확인합니다.",
  status: "available",
  route: "/operations",
  category: "시스템 관리",
  inputType: "Commerce OS 실행원장, 데이터 최신도, 가격 Bulk 작업 상태",
  outputType: "실행 중·승인 대기·실패·오래된 데이터 통합 현황",
  historySupport: true,
  externalProject: false,
  note: "민감한 입력값은 표시하지 않고 상태·연관번호·실패 원인만 보여줍니다.",
  helperNote: "실행·데이터 상태 통합",
  actionLabel: "운영 안전상태 보기",
  safetyBadge: "실패·승인 대기 추적",
};

export const shoplingPriceAdjustmentModule: CommerceModule = {
  id: "shopling-price-adjustment-runner",
  title: "샵플링 판매가 인상·인하 실행기",
  navigationLabel: "샵플링 가격 인상·인하",
  description: "goods_key별 인상률·인하율을 최대 10,000개까지 입력하고, 첫 10개 검증 후 최대 50개씩 직렬 실행합니다.",
  status: "check_mode",
  route: "/shopling-price-adjustment-runner",
  category: "채널 자동화",
  inputType: "goods_key, adjustment_rate CSV/XLSX 또는 직접 붙여넣기",
  outputType: "실행 계획, 상품별 결과, 실패·미실행 상태",
  historySupport: false,
  externalProject: true,
  note: "첫 10개 실행 후 최대 50개씩 직렬 처리하며, 첫 실패 또는 전송 불확실 시 전체 진행을 중단합니다.",
  helperNote: "1만 개 Bulk 가격 조정",
  actionLabel: "가격 인상·인하 실행기 열기",
  safetyBadge: "첫 10개 안전 확인",
};

export const priceAdjustmentEngineModule: CommerceModule = {
  id: "price-adjustment-engine",
  title: "상품등급·가격조정",
  navigationLabel: "상품등급·가격조정",
  description:
    "확정 입고원가와 바코드별 3개월 판매강도를 분석하고 숨은 시즌을 자동 구분해 +6~-4 상품등급, 안전 목표가격, 단종후보 재고정리 상태를 제안합니다.",
  status: "available",
  route: "/price-adjustment-engine",
  category: "가격·수익 관리",
  inputType: "확정 입고원가, 바코드별 월 판매량, 샵플링 현재가, 상품마스터 확인재고",
  outputType: "상품등급, 자동 시즌판정, 등급 목표가격, -3~-4 재고정리 상태와 이력",
  historySupport: true,
  externalProject: false,
  note: "Ops Center 내부 이전 1단계입니다. 가격판정과 실행원장을 읽기만 하며 자체 등급 엔진과 실제 가격변경은 아직 분리되어 있습니다.",
  helperNote: "Ops Center 내부 · 조회 전용",
  actionLabel: "내부 상품등급 대시보드 보기",
  safetyBadge: "그림자 운영 · 실제 미반영",
};

export const productDecisionAgentModule: CommerceModule = {
  id: "product-decision-agent",
  title: "발주 추천",
  navigationLabel: "발주 추천",
  description:
    "같은 바코드 상품을 하나로 합쳐 실행 시점의 최신 판매, 상품마스터 확인재고, 중국 주문 중 미입고 수량을 반영해 신규 주문 필요량을 다시 계산합니다.",
  status: "available",
  route: "/product-decision-agent",
  category: "발주·입고 관리",
  inputType: "샵플링 최신 판매, 상품마스터 확인재고, 중국 주문초안·실주문·미입고 수량",
  outputType: "바코드별 신규 주문 필요량, 예산·MOQ·박스입수 반영 발주안",
  historySupport: true,
  externalProject: false,
  note: "Ops Center 자체 계산 엔진과 검증 D1 그림자 재계산까지 완료했습니다. 실시간 판매·재고·미입고 원장 연결과 Worker 전환을 진행 중입니다.",
  helperNote: "자체 엔진 · 실시간 연결 진행",
  actionLabel: "내부 발주 추천 보기",
  safetyBadge: "원인불명 0 · 쓰기 차단",
};

export const shoplingCategoryReviewQueueModule: CommerceModule = {
  id: "shopling-category-review-queue",
  title: "AI 카테고리 검토함",
  navigationLabel: "AI 카테고리 검토함",
  description:
    "신규 상품 출시 진행관리에서 AI가 추천한 샵플링 표준카테고리 중 검토 필요 상품을 한곳에서 승인·수정·보류·제외합니다.",
  status: "available",
  route: "/shopling-category-review-queue",
  category: "상품 출시 관리",
  inputType: "AI 추천 카테고리, 신뢰도, 추천 이유, 대안 카테고리",
  outputType: "승인된 샵플링 표준카테고리와 검토 이력",
  historySupport: true,
  externalProject: false,
  note: "같은 상품의 미검토 추천은 새 AI 실행 결과로 갱신되고, 승인된 진행관리 카테고리는 AI가 자동으로 덮어쓰지 않습니다.",
  helperNote: "다건 검토·일괄 승인",
  actionLabel: "검토함 열기",
  safetyBadge: "승인 후 진행관리 반영",
};

const renamedModuleRegistry: readonly CommerceModule[] = moduleRegistry.map((module) => {
  if (module.id === "china-order-cost") {
    return {
      ...module,
      route: "/china-order-manager",
      externalProject: false,
      note: "외부 Site로 이동하지 않고 Ops Center 내부 원가계산·운영원장 화면을 사용합니다. 주문·입고 이벤트 원장과 Worker 이전을 진행 중입니다.",
      helperNote: "Ops Center 내부 · 원장 이전 진행",
      actionLabel: "내부 발주·입고 관리 열기",
      safetyBadge: "실제 입고·재고 변경 차단",
    };
  }
  if (module.id === "shopling-price-modify-runner") {
    return {
      ...module,
      title: "샵플링 쇼핑몰별 가격정책 적용기",
      navigationLabel: "샵플링 가격정책 적용기",
      description: "goods_key 기준으로 기본 판매가와 쇼핑몰별 지정 가격정책을 일괄 적용합니다.",
      helperNote: "실제 가격정책 적용",
      actionLabel: "가격정책 적용기 열기",
    };
  }
  return module;
});

export const extendedModuleRegistry: readonly CommerceModule[] = [
  commerceOperationsModule,
  ...renamedModuleRegistry,
  shoplingCategoryReviewQueueModule,
  productDecisionAgentModule,
  priceAdjustmentEngineModule,
  shoplingPriceAdjustmentModule,
];
