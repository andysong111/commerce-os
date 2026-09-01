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

// Legacy product-grade modules remain exportable for historical routes and audits,
// but are intentionally removed from the active Commerce OS module registry.
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
  note: "레거시 감사용 화면입니다. 새 운영 판단은 상품 생애주기·슬롯 최적화가 담당하며 상품등급은 가격·발주·Shopling 실행의 제어값으로 사용하지 않습니다.",
  helperNote: "레거시 감사 전용",
  actionLabel: "레거시 상품등급 기록 보기",
  safetyBadge: "운영 제어에서 제외",
};

export const priceGradeShadowComparisonModule: CommerceModule = {
  id: "price-grade-shadow-comparison",
  title: "상품등급 그림자 비교",
  navigationLabel: "상품등급 그림자 비교",
  description:
    "최근 24개월 판매와 최근 365일 확정 입고원가를 Ops Center 자체 등급 엔진으로 다시 계산해 Product Master 기존 lifecycle과 비교합니다.",
  status: "check_mode",
  route: "/price-adjustment-engine/shadow-compare",
  category: "가격·수익 관리",
  inputType: "안정 SKU 판매원장, 입고원가 원장, 기존 상품등급·목표가·보호가격",
  outputType: "완전 일치, 오래된 판정, 구형 규칙 차이, 원인 추가분석 대상",
  historySupport: true,
  externalProject: false,
  note: "레거시 검증용입니다. 정기 실행은 중단하고 기존 데이터만 감사·회귀 확인에 보존합니다.",
  helperNote: "레거시 검증 전용",
  actionLabel: "레거시 그림자 기록 보기",
  safetyBadge: "운영 제어에서 제외",
};

export const productMasterShoplingDiagnosticModule: CommerceModule = {
  id: "product-master-shopling-diagnostic",
  title: "상품마스터 Shopling 전수진단",
  navigationLabel: "상품마스터 연결 진단",
  description:
    "실제 Shopling 상품·옵션을 기간별로 읽어 상품마스터 위치코드와 대조하고, 미연결 goods_key·옵션 후보와 1+1·N개입의 재고 환산수량을 계산합니다.",
  status: "check_mode",
  route: "/product-master/shopling-diagnostic",
  category: "상품 출시 관리",
  inputType: "상품마스터 안정 SKU, Shopling 상품·옵션·옵션바코드·옵션자체관리코드",
  outputType: "정확한 기존 연결, 새 연결 후보, 오래된 연결, 환산수량 차이, 코드 충돌",
  historySupport: true,
  externalProject: false,
  note: "진단 결과만 불변 실행원장에 저장합니다. 상품마스터 연결값과 Shopling 상품·옵션은 변경하지 않습니다.",
  helperNote: "전수 읽기 · 실제 미반영",
  actionLabel: "Shopling 연결 전수진단",
  safetyBadge: "상품·재고·가격 쓰기 차단",
};

export const productLifecycleSlotModule: CommerceModule = {
  id: "product-lifecycle-slot-engine",
  title: "상품 생애주기 · 슬롯 최적화",
  navigationLabel: "상품 순환·슬롯 최적화",
  description:
    "상품등급 없이 마지막 판매일, 최근 판매속도, 재고확인 상태를 바탕으로 테스트·확대·유지·축소·휴면·재시험·단종을 결정하고 Shopling 판매상태와 발주권장에 연결합니다.",
  status: "check_mode",
  route: "/product-lifecycle",
  category: "상품 운영 자동화",
  inputType: "Product Master 365일 판매·마지막 판매일·확인재고, Shopling listing goods_key",
  outputType: "상품 생애주기, 판매중/품절/삭제 목표상태, 재발주 STOP, 예외 처리함",
  historySupport: true,
  externalProject: false,
  note: "현재 Shadow Mode입니다. 365일 무판매 + 검증된 재고 0 조건이 아니면 삭제 후보를 만들지 않으며, 실제 Shopling 반영 전 브라우저 회귀검증이 필요합니다.",
  helperNote: "상품등급 대체 · 예외 중심",
  actionLabel: "상품 순환·예외 화면 보기",
  safetyBadge: "Shadow · 삭제 안전선",
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
  note: "상품 생애주기 엔진이 운영모드로 전환되면 휴면·단종 SKU의 재발주를 최종 차단합니다. 상품등급은 발주 제어값으로 사용하지 않습니다.",
  helperNote: "자체 엔진 · 생애주기 연결",
  actionLabel: "내부 발주 추천 보기",
  safetyBadge: "생애주기 Shadow 연결",
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

export const internalChinaCostPriceReviewModule: CommerceModule = {
  id: "internal-china-cost-price-review",
  title: "확정원가 · 상품그룹 가격조정",
  navigationLabel: "확정원가 가격조정",
  description:
    "확정 실제원가를 기준으로 도매1~도매4·소매1~소매2 상품그룹 목표가와 연결 쇼핑몰별 가격정책을 함께 검토하고 승인·적용합니다.",
  status: "available",
  route: "/china-order-manager/price-review",
  category: "가격·수익 관리",
  inputType: "확정 실제원가, 주문당 수량, OPS 내부 가격그룹, Shopling 현재가·판매상태",
  outputType: "상품그룹 기준가, 연결 쇼핑몰별 목표가, 승인·Shopling 적용 상태",
  historySupport: true,
  externalProject: false,
  note: "가격조정안 승인은 정책·대상 확정 단계입니다. 실제 Shopling 가격 쓰기는 승인 후 나타나는 적용 버튼에서 별도로 실행합니다.",
  helperNote: "확정원가 → 그룹·쇼핑몰 목표가",
  actionLabel: "가격조정 검토 열기",
  safetyBadge: "승인 후 별도 적용",
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
  internalChinaCostPriceReviewModule,
  productMasterShoplingDiagnosticModule,
  productLifecycleSlotModule,
  productDecisionAgentModule,
  shoplingPriceAdjustmentModule,
];
