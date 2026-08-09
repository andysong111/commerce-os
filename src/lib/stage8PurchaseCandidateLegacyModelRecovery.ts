import { createHash } from "node:crypto";
import {
  legacyModelIdentityEvidenceByBarcode,
  type LegacyModelIdentityEvidence,
} from "@/data/stage8LegacyModelIdentityEvidence";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";

export type LegacyModelRecoveryState =
  | "RECOVERED_EXACT"
  | "CURRENT_MODEL_ALREADY_EXACT"
  | "PLACEHOLDER_UNRECOVERED"
  | "CONFLICT";

export type PurchaseCandidateLegacyModelRecoveryRow = {
  barcode: string;
  currentModelNo: string | null;
  recoveredModelNo: string | null;
  effectiveModelNo: string | null;
  productName: string;
  recommendedQty: number;
  inventoryMode: string;
  costGate: string;
  state: LegacyModelRecoveryState;
  source: LegacyModelIdentityEvidence | null;
  orderHistoryJoinAllowed: boolean;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

export type PurchaseCandidateLegacyModelRecovery = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  upstreamPurchaseState: "READY" | "BLOCKED";
  message: string;
  purchaseCandidateCount: number;
  recoveredExactCount: number;
  currentExactCount: number;
  unrecoveredCount: number;
  conflictCount: number;
  orderHistoryJoinEligibleCount: number;
  fingerprint: string;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: PurchaseCandidateLegacyModelRecoveryRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeModelNo(value: unknown) {
  return text(value).toLowerCase();
}

function isExactAaaModel(value: unknown) {
  return /^aaa\d{3,}$/i.test(text(value));
}

function isLegacyPlaceholder(value: unknown) {
  return /^legacy-/i.test(text(value));
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadPurchaseCandidateLegacyModelRecovery(): Promise<PurchaseCandidateLegacyModelRecovery> {
  const priority = await loadInventoryVerificationPriority();
  const evidence = legacyModelIdentityEvidenceByBarcode();
  const candidates = priority.rows.filter((row) => row.purchaseStatus === "발주 추천");

  const rows = candidates
    .map((row): PurchaseCandidateLegacyModelRecoveryRow => {
      const barcode = normalizeBarcode(row.barcode);
      const currentModelNo = text(row.modelNo) || null;
      const source = evidence.get(barcode) ?? null;
      const recoveredModelNo = source?.recoveredModelNo ?? null;
      let state: LegacyModelRecoveryState = "PLACEHOLDER_UNRECOVERED";

      if (isExactAaaModel(currentModelNo)) {
        state =
          source && normalizeModelNo(source.recoveredModelNo) !== normalizeModelNo(currentModelNo)
            ? "CONFLICT"
            : "CURRENT_MODEL_ALREADY_EXACT";
      } else if (source && (!currentModelNo || isLegacyPlaceholder(currentModelNo))) {
        state = "RECOVERED_EXACT";
      } else if (source && currentModelNo) {
        state = "CONFLICT";
      }

      const effectiveModelNo =
        state === "RECOVERED_EXACT"
          ? recoveredModelNo
          : state === "CURRENT_MODEL_ALREADY_EXACT"
            ? currentModelNo
            : null;
      const orderHistoryJoinAllowed = Boolean(effectiveModelNo) && state !== "CONFLICT";

      return {
        barcode,
        currentModelNo,
        recoveredModelNo,
        effectiveModelNo,
        productName: text(row.name),
        recommendedQty: row.recommendedQty,
        inventoryMode: row.inventoryMode,
        costGate: row.action,
        state,
        source,
        orderHistoryJoinAllowed,
        inventoryPromotionAllowed: false,
        purchaseWritesEnabled: false,
        inventoryWritesEnabled: false,
      };
    })
    .sort(
      (left, right) =>
        Number(right.state === "CONFLICT") - Number(left.state === "CONFLICT") ||
        Number(left.orderHistoryJoinAllowed) - Number(right.orderHistoryJoinAllowed) ||
        left.barcode.localeCompare(right.barcode),
    );

  const recoveredExactCount = rows.filter((row) => row.state === "RECOVERED_EXACT").length;
  const currentExactCount = rows.filter(
    (row) => row.state === "CURRENT_MODEL_ALREADY_EXACT",
  ).length;
  const conflictCount = rows.filter((row) => row.state === "CONFLICT").length;
  const unrecoveredCount = rows.filter(
    (row) => row.state === "PLACEHOLDER_UNRECOVERED",
  ).length;
  const orderHistoryJoinEligibleCount = rows.filter(
    (row) => row.orderHistoryJoinAllowed,
  ).length;
  const readOnlyEvidenceReady = rows.length > 0;
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    currentModelNo: row.currentModelNo,
    recoveredModelNo: row.recoveredModelNo,
    effectiveModelNo: row.effectiveModelNo,
    state: row.state,
    sourceArtifact: row.source?.sourceArtifact ?? null,
    sourceSheet: row.source?.sourceSheet ?? null,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: readOnlyEvidenceReady ? "READY_READ_ONLY" : "BLOCKED",
    upstreamPurchaseState: priority.state,
    message: readOnlyEvidenceReady
      ? priority.state === "READY"
        ? "과거 자료에서 B-code와 aaa 모델번호가 직접 함께 기록된 증거만 EXACT로 복구합니다. 상품명이 비슷하다는 이유만으로 모델번호를 추정하지 않으며, 미복구·충돌 행은 과거 발주이력 연결을 차단합니다."
        : "읽기 전용 모델번호 복구 증거는 준비되었습니다. 다만 상위 발주 실행 준비상태는 BLOCKED이므로 이 결과는 증거 연결에만 사용하고 발주 실행에는 사용하지 않습니다."
      : "현재 발주후보 행이 없어 모델번호 복구 증거를 만들 수 없습니다.",
    purchaseCandidateCount: rows.length,
    recoveredExactCount,
    currentExactCount,
    unrecoveredCount,
    conflictCount,
    orderHistoryJoinEligibleCount,
    fingerprint: sha256({
      upstreamPurchaseState: priority.state,
      rows: stable,
    }),
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}
