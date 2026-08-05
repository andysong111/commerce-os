import {
  createProductDecisionLiveRefreshRequest,
  loadProductDecisionLiveStatus,
  type ProductDecisionLiveStatus,
} from "@/lib/productDecisionLiveRefresh";
import { runShoplingOrderNetworkDiagnostic } from "@/lib/shopling/shoplingNetworkDiagnostic";

export const LEGACY_SHOPLING_FETCH_FAILURE_CUTOFF =
  "2026-08-05T16:16:04.000Z";

export type ProductDecisionLiveRecoveryResult = {
  checked: boolean;
  recovered: boolean;
  reason:
    | "NOT_FAILED"
    | "NOT_LEGACY_FETCH_FAILURE"
    | "SHOPLING_DIAGNOSTIC_FAILED"
    | "RECOVERED";
  previousRequestId: string | null;
  requestId: string | null;
  transportMode: "standard" | "scoped_legacy_dh" | null;
};

function beforeCutoff(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return (
    Number.isFinite(parsed) &&
    parsed < Date.parse(LEGACY_SHOPLING_FETCH_FAILURE_CUTOFF)
  );
}

export function isRecoverableLegacyShoplingFetchFailure(
  status: Pick<
    ProductDecisionLiveStatus,
    "state" | "stage" | "error" | "analysisAsOf"
  >,
) {
  if (status.state !== "FAILED") return false;
  if (!/^(?:order|claim):/.test(status.stage)) return false;
  if (status.error?.trim().toLowerCase() !== "fetch failed") return false;
  return beforeCutoff(status.analysisAsOf);
}

export async function recoverLegacyShoplingFetchFailure(): Promise<ProductDecisionLiveRecoveryResult> {
  const status = await loadProductDecisionLiveStatus();
  if (status.state !== "FAILED") {
    return {
      checked: false,
      recovered: false,
      reason: "NOT_FAILED",
      previousRequestId: status.requestId,
      requestId: null,
      transportMode: null,
    };
  }
  if (!isRecoverableLegacyShoplingFetchFailure(status)) {
    return {
      checked: true,
      recovered: false,
      reason: "NOT_LEGACY_FETCH_FAILURE",
      previousRequestId: status.requestId,
      requestId: null,
      transportMode: null,
    };
  }

  const diagnostic = await runShoplingOrderNetworkDiagnostic();
  if (!diagnostic.ok) {
    return {
      checked: true,
      recovered: false,
      reason: "SHOPLING_DIAGNOSTIC_FAILED",
      previousRequestId: status.requestId,
      requestId: null,
      transportMode: diagnostic.transportMode,
    };
  }

  const request = await createProductDecisionLiveRefreshRequest();
  return {
    checked: true,
    recovered: true,
    reason: "RECOVERED",
    previousRequestId: status.requestId,
    requestId: request.requestId,
    transportMode: diagnostic.transportMode,
  };
}
