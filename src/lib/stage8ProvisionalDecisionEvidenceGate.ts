import { createHash } from "node:crypto";
import { loadProvisionalInventoryDiagnostics } from "@/lib/stage8ProvisionalInventoryDiagnostics";

export type ProvisionalDecisionEvidenceGateState =
  | "DRAFT_EVIDENCE_READY"
  | "HOLD_EVIDENCE_READY"
  | "INVENTORY_SENSITIVE"
  | "INSUFFICIENT_EVIDENCE";

export type ProvisionalDecisionEvidenceGateRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  state: ProvisionalDecisionEvidenceGateState;
  reason: string;
  diagnosticLowQuantity: number | null;
  diagnosticHighQuantity: number | null;
  lowRecommendedQuantity: number | null;
  highRecommendedQuantity: number | null;
  conservativeDraftRecommendedQuantity: number;
  provisionalDecisionEvidenceReady: boolean;
  draftEvidenceReady: boolean;
  actualDraftCreationEnabled: false;
  automaticPurchaseEnabled: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

export type ProvisionalDecisionEvidenceGate = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  message: string;
  sourceFingerprint: string;
  evaluatedCount: number;
  draftEvidenceReadyCount: number;
  holdEvidenceReadyCount: number;
  inventorySensitiveCount: number;
  insufficientEvidenceCount: number;
  fingerprint: string;
  actualDraftCreationEnabled: false;
  automaticPurchaseEnabled: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: ProvisionalDecisionEvidenceGateRow[];
};

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadProvisionalDecisionEvidenceGate(): Promise<ProvisionalDecisionEvidenceGate> {
  const diagnostics = await loadProvisionalInventoryDiagnostics();
  const rows = diagnostics.rows.map((row): ProvisionalDecisionEvidenceGateRow => {
    const common = {
      barcode: row.barcode,
      modelNo: row.modelNo,
      productName: row.productName,
      diagnosticLowQuantity: row.diagnosticLowQuantity,
      diagnosticHighQuantity: row.diagnosticHighQuantity,
      lowRecommendedQuantity: row.lowRecommendedQuantity,
      highRecommendedQuantity: row.highRecommendedQuantity,
      conservativeDraftRecommendedQuantity: 0,
      actualDraftCreationEnabled: false as const,
      automaticPurchaseEnabled: false as const,
      inventoryPromotionAllowed: false as const,
      purchaseWritesEnabled: false as const,
      inventoryWritesEnabled: false as const,
    };

    if (row.state !== "BAND_READY") {
      return {
        ...common,
        state: "INSUFFICIENT_EVIDENCE",
        reason: row.message,
        provisionalDecisionEvidenceReady: false,
        draftEvidenceReady: false,
      };
    }

    if (row.decisionState === "ORDER_DIRECTION_STABLE") {
      return {
        ...common,
        state: "DRAFT_EVIDENCE_READY",
        reason:
          "추정재고 밴드의 낮은값과 높은값 모두에서 발주 방향이 동일하고, 보수적 Draft 수량이 양수입니다. 이는 Draft 실행 증거 후보일 뿐 실제 Draft 생성 권한은 열지 않습니다.",
        conservativeDraftRecommendedQuantity:
          row.conservativeDraftRecommendedQuantity,
        provisionalDecisionEvidenceReady: true,
        draftEvidenceReady: row.conservativeDraftRecommendedQuantity > 0,
      };
    }

    if (row.decisionState === "HOLD_DIRECTION_STABLE") {
      return {
        ...common,
        state: "HOLD_EVIDENCE_READY",
        reason:
          "추정재고 밴드의 낮은값과 높은값 모두에서 발주 보류 방향이 동일합니다. 신규 Draft를 만들지 않는 판단만 안정적입니다.",
        provisionalDecisionEvidenceReady: true,
        draftEvidenceReady: false,
      };
    }

    return {
      ...common,
      state: "INVENTORY_SENSITIVE",
      reason:
        "추정재고 밴드 안에서 발주/보류 방향이 바뀌므로 PROVISIONAL 증거만으로 Draft 실행을 허용하지 않습니다.",
      provisionalDecisionEvidenceReady: false,
      draftEvidenceReady: false,
    };
  });

  const ready = diagnostics.state === "READY_READ_ONLY";
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    state: row.state,
    low: row.diagnosticLowQuantity,
    high: row.diagnosticHighQuantity,
    lowRecommended: row.lowRecommendedQuantity,
    highRecommended: row.highRecommendedQuantity,
    conservativeDraft: row.conservativeDraftRecommendedQuantity,
    evidenceReady: row.provisionalDecisionEvidenceReady,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_READ_ONLY" : "BLOCKED",
    message: ready
      ? "PROVISIONAL 재고는 한 점 추정값이 아니라 증명된 불확실성 밴드의 발주 방향 안정성으로만 별도 실행증거 후보를 판정합니다. 실제 Draft 생성과 자동구매는 계속 OFF입니다."
      : "상위 추정재고 진단이 준비되지 않아 PROVISIONAL 실행증거 후보를 만들지 않습니다.",
    sourceFingerprint: diagnostics.fingerprint,
    evaluatedCount: rows.length,
    draftEvidenceReadyCount: rows.filter((row) => row.state === "DRAFT_EVIDENCE_READY").length,
    holdEvidenceReadyCount: rows.filter((row) => row.state === "HOLD_EVIDENCE_READY").length,
    inventorySensitiveCount: rows.filter((row) => row.state === "INVENTORY_SENSITIVE").length,
    insufficientEvidenceCount: rows.filter((row) => row.state === "INSUFFICIENT_EVIDENCE").length,
    fingerprint: sha256({ sourceFingerprint: diagnostics.fingerprint, rows: stable }),
    actualDraftCreationEnabled: false,
    automaticPurchaseEnabled: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}
