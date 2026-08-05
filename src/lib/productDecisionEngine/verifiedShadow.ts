import type { ProductDecisionShadowReport } from "./shadowComparison.ts";

export const VERIFIED_PRODUCT_DECISION_SHADOW = {
  runId: "0117e77a-a5ae-4f81-98c4-5a0ff72cde61",
  analysisAsOf: "2026-08-04T09:45:20.591Z",
  productCount: 316,
  exactFinalCount: 311,
  finalMismatchCount: 5,
  sourceInputDriftCount: 8,
  salesCalculationMismatchCount: 10,
  unexplainedMismatchCount: 0,
  expectedProductOrderBudget: 3_309_555,
  replayProductOrderBudget: 3_298_297,
  productOrderBudgetDelta: -11_258,
  expectedSpend: 3_309_000,
  replayExpectedSpend: 3_298_010,
  expectedOrderCount: 42,
  replayOrderCount: 41,
} as const;

export function validateVerifiedProductDecisionShadow(
  report: ProductDecisionShadowReport,
) {
  for (const [key, expected] of Object.entries(
    VERIFIED_PRODUCT_DECISION_SHADOW,
  )) {
    const actual = report[key as keyof ProductDecisionShadowReport];
    if (actual !== expected) {
      throw new Error(
        `검증된 그림자 재계산 결과와 다릅니다. ${key}: ${String(actual)} ≠ ${String(expected)}`,
      );
    }
  }
  if (report.products.length !== VERIFIED_PRODUCT_DECISION_SHADOW.productCount) {
    throw new Error("그림자 재계산 상품 상세 수가 검증값과 다릅니다.");
  }
  if (
    report.products.some(
      (row) => !row.finalMatch && row.mismatchReason === "UNEXPLAINED",
    )
  ) {
    throw new Error("원인 설명이 되지 않는 발주 추천 불일치가 있습니다.");
  }
}
