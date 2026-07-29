import { moduleRegistry, type CommerceModule } from "@/lib/moduleRegistry";

export const shoplingPriceAdjustmentModule: CommerceModule = {
  id: "shopling-price-adjustment-runner",
  title: "샵플링 판매가 인상·인하 실행기",
  navigationLabel: "샵플링 가격 인상·인하",
  description: "goods_key별 인상률·인하율을 최대 20,000개까지 입력하고, 현재 가격 조회 전 입력·계산 계획을 검증합니다.",
  status: "check_mode",
  route: "/shopling-price-adjustment-runner",
  category: "채널 자동화",
  inputType: "goods_key, adjustment_rate CSV/XLSX 또는 직접 붙여넣기",
  outputType: "검증된 상품별 조정률과 가격 계산 계획",
  historySupport: false,
  externalProject: true,
  note: "현재 1단계는 가격 쓰기 없이 대량 입력과 10원 단위 올림 계산만 검증합니다.",
  helperNote: "대량 입력·계산 준비",
  actionLabel: "인상·인하 입력 열기",
  safetyBadge: "가격 쓰기 차단",
};

export const extendedModuleRegistry: readonly CommerceModule[] = [
  ...moduleRegistry,
  shoplingPriceAdjustmentModule,
];
