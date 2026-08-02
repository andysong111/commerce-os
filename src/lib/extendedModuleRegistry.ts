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
  title: "입고원가·판매추이 가격조정",
  navigationLabel: "입고원가 가격조정",
  description:
    "확정 입고원가와 전년 동일기간을 포함한 장기 판매추이를 바코드별로 합쳐 가격 인상 필요 상품과 보수적 인하 검토 상품을 제안합니다.",
  status: "available",
  route:
    process.env.NEXT_PUBLIC_PRICE_ADJUSTMENT_ENGINE_URL?.trim() ||
    "https://commerce-os-price-adjustment-engine.andy123df23.chatgpt.site",
  category: "가격·수익 관리",
  inputType: "확정 입고원가, 샵플링 현재 판매가, 최대 24개월 월별 판매량",
  outputType: "인상 필요, 인하 검토, 단종 정리, 가격 유지 목록",
  historySupport: true,
  externalProject: true,
  note: "인상은 기본 선택하고, 일반 인하와 단종 정리는 사용자가 직접 선택합니다. 현재 재고수량 입력은 필요하지 않습니다.",
  helperNote: "마진 방어 · 인하는 수동 선택",
  actionLabel: "가격조정안 보기",
  safetyBadge: "인하는 수동 선택",
};

export const productDecisionAgentModule: CommerceModule = {
  id: "product-decision-agent",
  title: "발주·단종 추천",
  navigationLabel: "발주·단종 추천",
  description:
    "같은 바코드 상품을 하나로 합쳐 1·2·3·6·12개월 판매와 클레임·포장 난이도를 분석하고, 이번 달 발주수량과 단종 후보를 제안합니다.",
  status: "available",
  route: "https://commerce-os-product-decision-agent.andy123df23.chatgpt.site",
  category: "발주·입고 관리",
  inputType: "샵플링 상품·주문·클레임, 포장 난이도",
  outputType: "월간 발주안, 재고 차감 전 권장수량, 단종·보류 목록",
  historySupport: true,
  externalProject: true,
  note: "독립 에이전트가 매월 발주안을 자동 생성합니다. 실제 발주와 단종은 사용자가 최종 결정합니다.",
  helperNote: "매월 자동 생성 · 사용 가능",
  actionLabel: "이번 달 발주안 보기",
  safetyBadge: "재고 차감 전",
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

const renamedModuleRegistry: readonly CommerceModule[] = moduleRegistry.map((module) =>
  module.id === "shopling-price-modify-runner"
    ? {
        ...module,
        title: "샵플링 쇼핑몰별 가격정책 적용기",
        navigationLabel: "샵플링 가격정책 적용기",
        description: "goods_key 기준으로 기본 판매가와 쇼핑몰별 지정 가격정책을 일괄 적용합니다.",
        helperNote: "실제 가격정책 적용",
        actionLabel: "가격정책 적용기 열기",
      }
    : module,
);

export const extendedModuleRegistry: readonly CommerceModule[] = [
  commerceOperationsModule,
  ...renamedModuleRegistry,
  shoplingCategoryReviewQueueModule,
  productDecisionAgentModule,
  priceAdjustmentEngineModule,
  shoplingPriceAdjustmentModule,
];
