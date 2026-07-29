import { moduleRegistry, type CommerceModule } from "@/lib/moduleRegistry";

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
  ...renamedModuleRegistry,
  shoplingPriceAdjustmentModule,
];
