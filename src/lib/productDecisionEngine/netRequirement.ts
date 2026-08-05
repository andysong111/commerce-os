import {
  roundOrderQuantity,
  type SalesOrderGroup,
} from "@/lib/productDecisionEngine/salesOrder";

export type NetRequirementInput = {
  demandTarget: number;
  originalGroup: SalesOrderGroup;
  inventoryKnown: boolean;
  availableQuantity?: number;
  reservedQuantity?: number;
  incomingQuantity?: number;
  ledgerCommitment?: number;
  moq?: number;
  cartonQuantity?: number;
};

export type NetRequirementResult = {
  demandTarget: number;
  inventoryKnown: boolean;
  estimatedStock: number;
  incomingSnapshot: number;
  ledgerCommitment: number;
  openCommitment: number;
  securedQuantity: number;
  netRequiredRaw: number;
  recommendedQuantity: number;
  group: SalesOrderGroup;
};

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

/**
 * 확인된 추정재고와 아직 입고되지 않은 중국 주문수량을 수요 목표에서 차감한다.
 * 동일 발주가 재고 스냅샷 incoming과 발주 약정 원장 양쪽에 존재할 수 있으므로
 * 둘을 더하지 않고 더 큰 값 하나만 사용한다.
 */
export function calculateNetRequirement(
  input: NetRequirementInput,
): NetRequirementResult {
  const demandTarget = quantity(input.demandTarget);
  const estimatedStock = input.inventoryKnown
    ? Math.max(
        0,
        quantity(input.availableQuantity) - quantity(input.reservedQuantity),
      )
    : 0;
  const incomingSnapshot = input.inventoryKnown
    ? quantity(input.incomingQuantity)
    : 0;
  const ledgerCommitment = quantity(input.ledgerCommitment);
  const openCommitment = Math.max(incomingSnapshot, ledgerCommitment);
  const securedQuantity = estimatedStock + openCommitment;
  const netRequiredRaw = Math.max(0, demandTarget - securedQuantity);
  const recommendedQuantity = roundOrderQuantity(
    netRequiredRaw,
    input.moq,
    input.cartonQuantity,
  );
  const group =
    recommendedQuantity > 0 ? input.originalGroup : ("발주 보류" as const);

  return {
    demandTarget,
    inventoryKnown: input.inventoryKnown,
    estimatedStock,
    incomingSnapshot,
    ledgerCommitment,
    openCommitment,
    securedQuantity,
    netRequiredRaw,
    recommendedQuantity,
    group,
  };
}
