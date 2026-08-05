import { runPriceGradeShadowComparisonWithReceiptCache } from "@/lib/priceGradeReceiptCacheShadow";
import {
  loadLatestPriceGradeShadowComparison,
  type PriceGradeShadowResult,
} from "@/lib/priceGradeShadowComparison";

const RECEIPT_AUGMENTATION_VERSION = "receipt-cache-fallback-v1";

type ReceiptAwareStoredResult = PriceGradeShadowResult & {
  receiptEvidence?: {
    augmentationVersion?: string;
    fallbackProductCount?: number;
    remainingWithoutReceiptCount?: number;
  };
};

export type PriceGradeReceiptShadowBootstrapResult = {
  processed: boolean;
  reason: "ALREADY_BOOTSTRAPPED" | "BOOTSTRAPPED";
  runId: string | null;
  inputCount: number;
  blockedCount: number;
  unexplainedCount: number;
  fallbackProductCount: number;
  remainingWithoutReceiptCount: number;
  writesEnabled: false;
};

function hasCurrentReceiptEvidence(
  result: PriceGradeShadowResult | null,
): result is ReceiptAwareStoredResult {
  const evidence = (result as ReceiptAwareStoredResult | null)?.receiptEvidence;
  return evidence?.augmentationVersion === RECEIPT_AUGMENTATION_VERSION;
}

export async function runPriceGradeReceiptShadowBootstrap(): Promise<PriceGradeReceiptShadowBootstrapResult> {
  const latest = await loadLatestPriceGradeShadowComparison();
  if (hasCurrentReceiptEvidence(latest)) {
    return {
      processed: false,
      reason: "ALREADY_BOOTSTRAPPED",
      runId: latest.runId,
      inputCount: latest.summary.inputCount,
      blockedCount: latest.summary.blockedCount,
      unexplainedCount: latest.summary.unexplainedCount,
      fallbackProductCount: Number(
        latest.receiptEvidence?.fallbackProductCount ?? 0,
      ),
      remainingWithoutReceiptCount: Number(
        latest.receiptEvidence?.remainingWithoutReceiptCount ?? 0,
      ),
      writesEnabled: false,
    };
  }

  const result = await runPriceGradeShadowComparisonWithReceiptCache();
  return {
    processed: true,
    reason: "BOOTSTRAPPED",
    runId: result.runId,
    inputCount: result.summary.inputCount,
    blockedCount: result.summary.blockedCount,
    unexplainedCount: result.summary.unexplainedCount,
    fallbackProductCount: result.receiptEvidence.fallbackProductCount,
    remainingWithoutReceiptCount:
      result.receiptEvidence.remainingWithoutReceiptCount,
    writesEnabled: false,
  };
}
