import { createHash } from "node:crypto";
import {
  legacyOrderHistoryEvidenceByBarcode,
  type LegacyOrderHistoryEvidence,
} from "@/data/stage8LegacyOrderHistoryEvidence";
import { loadPurchaseCandidateLegacyModelRecovery } from "@/lib/stage8PurchaseCandidateLegacyModelRecovery";

export type LegacyOrderHistoryJoinState =
  | "JOINED_COMPLETE"
  | "JOINED_CUMULATIVE_ONLY"
  | "EVIDENCE_MISSING"
  | "MODEL_MISMATCH"
  | "IDENTITY_BLOCKED";

export type LegacyOrderHistoryJoinShadowRow = {
  barcode: string;
  productName: string;
  effectiveModelNo: string | null;
  state: LegacyOrderHistoryJoinState;
  evidence: LegacyOrderHistoryEvidence | null;
  cumulativeScenarioEligible: boolean;
  latestOrderScenarioEligible: boolean;
  safeCumulativeOrderQuantity: number | null;
  latestSafeOrderDate: string | null;
  latestSafeOrderQuantity: number | null;
  confirmedInbound: false;
  inventoryUseAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

export type LegacyOrderHistoryJoinShadow = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  upstreamPurchaseState: "READY" | "BLOCKED";
  message: string;
  recoveredIdentityCount: number;
  joinedCompleteCount: number;
  joinedCumulativeOnlyCount: number;
  evidenceMissingCount: number;
  modelMismatchCount: number;
  identityBlockedCount: number;
  cumulativeScenarioEligibleCount: number;
  latestOrderScenarioEligibleCount: number;
  fingerprint: string;
  orderHistoryConfirmedInbound: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: LegacyOrderHistoryJoinShadowRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeModelNo(value: unknown) {
  return text(value).toLowerCase();
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadLegacyOrderHistoryJoinShadow(): Promise<LegacyOrderHistoryJoinShadow> {
  const recovery = await loadPurchaseCandidateLegacyModelRecovery();
  const evidenceByBarcode = legacyOrderHistoryEvidenceByBarcode();

  const rows = recovery.rows.map((identity): LegacyOrderHistoryJoinShadowRow => {
    const evidence = evidenceByBarcode.get(identity.barcode) ?? null;
    const effectiveModelNo = identity.effectiveModelNo;
    let state: LegacyOrderHistoryJoinState = "IDENTITY_BLOCKED";

    if (identity.orderHistoryJoinAllowed && effectiveModelNo) {
      if (!evidence) {
        state = "EVIDENCE_MISSING";
      } else if (normalizeModelNo(evidence.modelNo) !== normalizeModelNo(effectiveModelNo)) {
        state = "MODEL_MISMATCH";
      } else if (
        evidence.latestOrderEvidenceState === "EXACT" &&
        evidence.latestSafeOrderQuantity !== null
      ) {
        state = "JOINED_COMPLETE";
      } else {
        state = "JOINED_CUMULATIVE_ONLY";
      }
    }

    const cumulativeScenarioEligible =
      (state === "JOINED_COMPLETE" || state === "JOINED_CUMULATIVE_ONLY") &&
      Boolean(evidence && evidence.safeCumulativeOrderQuantity >= 0);
    const latestOrderScenarioEligible =
      state === "JOINED_COMPLETE" &&
      Boolean(
        evidence &&
          evidence.latestOrderEvidenceState === "EXACT" &&
          evidence.latestSafeOrderQuantity !== null,
      );

    return {
      barcode: identity.barcode,
      productName: identity.productName,
      effectiveModelNo,
      state,
      evidence,
      cumulativeScenarioEligible,
      latestOrderScenarioEligible,
      safeCumulativeOrderQuantity: cumulativeScenarioEligible
        ? evidence?.safeCumulativeOrderQuantity ?? null
        : null,
      latestSafeOrderDate:
        state === "JOINED_COMPLETE" || state === "JOINED_CUMULATIVE_ONLY"
          ? evidence?.latestSafeOrderDate ?? null
          : null,
      latestSafeOrderQuantity: latestOrderScenarioEligible
        ? evidence?.latestSafeOrderQuantity ?? null
        : null,
      confirmedInbound: false,
      inventoryUseAllowed: false,
      inventoryPromotionAllowed: false,
      purchaseWritesEnabled: false,
      inventoryWritesEnabled: false,
    };
  });

  const joinedCompleteCount = rows.filter((row) => row.state === "JOINED_COMPLETE").length;
  const joinedCumulativeOnlyCount = rows.filter(
    (row) => row.state === "JOINED_CUMULATIVE_ONLY",
  ).length;
  const evidenceMissingCount = rows.filter((row) => row.state === "EVIDENCE_MISSING").length;
  const modelMismatchCount = rows.filter((row) => row.state === "MODEL_MISMATCH").length;
  const identityBlockedCount = rows.filter((row) => row.state === "IDENTITY_BLOCKED").length;
  const recoveredIdentityCount = recovery.rows.filter((row) => row.orderHistoryJoinAllowed).length;
  const readOnlyReady = rows.length > 0;
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    effectiveModelNo: row.effectiveModelNo,
    state: row.state,
    safeCumulativeOrderQuantity: row.safeCumulativeOrderQuantity,
    latestSafeOrderDate: row.latestSafeOrderDate,
    latestSafeOrderQuantity: row.latestSafeOrderQuantity,
    evidenceModelNo: row.evidence?.modelNo ?? null,
    evidenceKind: row.evidence?.evidenceKind ?? null,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: readOnlyReady ? "READY_READ_ONLY" : "BLOCKED",
    upstreamPurchaseState: recovery.upstreamPurchaseState,
    message: readOnlyReady
      ? "복구된 aaa 정체성과 과거 발주이력 증거를 B-code별로 읽기 전용 연결했습니다. 과거 주문수량은 확정입고나 현재 재고가 아니며, 누적수량과 최신 1회 수량의 증거 수준을 따로 관리합니다."
      : "현재 발주후보 정체성 행이 없어 과거 발주이력 shadow를 만들 수 없습니다.",
    recoveredIdentityCount,
    joinedCompleteCount,
    joinedCumulativeOnlyCount,
    evidenceMissingCount,
    modelMismatchCount,
    identityBlockedCount,
    cumulativeScenarioEligibleCount: rows.filter((row) => row.cumulativeScenarioEligible).length,
    latestOrderScenarioEligibleCount: rows.filter((row) => row.latestOrderScenarioEligible).length,
    fingerprint: sha256({
      recoveryFingerprint: recovery.fingerprint,
      upstreamPurchaseState: recovery.upstreamPurchaseState,
      rows: stable,
    }),
    orderHistoryConfirmedInbound: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}
