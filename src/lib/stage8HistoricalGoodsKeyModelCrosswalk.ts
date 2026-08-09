import { createHash } from "node:crypto";
import {
  historicalGoodsKeyModelEvidence,
  type HistoricalGoodsKeyModelEvidence,
} from "@/data/stage8HistoricalGoodsKeyModelEvidence";
import { historicalGoodsKeyModelEvidenceExpansion1 } from "@/data/stage8HistoricalGoodsKeyModelEvidenceExpansion1";
import { loadPurchaseCandidateShoplingIdentityAudit } from "@/lib/stage8PurchaseCandidateShoplingIdentityAudit";

export type HistoricalGoodsKeyModelCrosswalkState =
  | "SINGLE_MODEL_FULL_COVERAGE"
  | "MULTI_MODEL_FULL_COVERAGE"
  | "PARTIAL_COVERAGE"
  | "NO_EVIDENCE"
  | "MODEL_CONFLICT"
  | "NO_ACTIVE_LISTING";

export type HistoricalGoodsKeyModelCrosswalkRow = {
  barcode: string;
  productName: string;
  currentGoodsKeys: string[];
  evidencedGoodsKeys: string[];
  uncoveredGoodsKeys: string[];
  conflictingGoodsKeys: string[];
  originalModelNos: string[];
  pricingCrossMatchModelNos: string[];
  state: HistoricalGoodsKeyModelCrosswalkState;
  coveragePct: number;
  singleModelFullCoverageCandidate: boolean;
  historicalOrderAggregationAllowed: false;
  inventoryUseAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  shoplingWritesEnabled: false;
  evidence: HistoricalGoodsKeyModelEvidence[];
};

export type HistoricalGoodsKeyModelCrosswalk = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  message: string;
  purchaseCandidateCount: number;
  evidenceRecordCount: number;
  evidenceGoodsKeyCount: number;
  singleModelFullCoverageCount: number;
  multiModelFullCoverageCount: number;
  partialCoverageCount: number;
  noEvidenceCount: number;
  modelConflictCount: number;
  noActiveListingCount: number;
  fingerprint: string;
  historicalOrderAggregationAllowed: false;
  inventoryUseAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  shoplingWritesEnabled: false;
  rows: HistoricalGoodsKeyModelCrosswalkRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function evidenceByGoodsKey(rows: HistoricalGoodsKeyModelEvidence[]) {
  const index = new Map<string, HistoricalGoodsKeyModelEvidence[]>();
  for (const row of rows) {
    const key = text(row.goodsKey);
    if (!key) continue;
    const bucket = index.get(key) ?? [];
    bucket.push(row);
    index.set(key, bucket);
  }
  return index;
}

function conflictFor(rows: HistoricalGoodsKeyModelEvidence[]) {
  return new Set(rows.map((row) => text(row.originalModelNo).toLowerCase())).size > 1;
}

export async function loadHistoricalGoodsKeyModelCrosswalk(): Promise<HistoricalGoodsKeyModelCrosswalk> {
  const identity = await loadPurchaseCandidateShoplingIdentityAudit();
  const evidenceRows = [
    ...historicalGoodsKeyModelEvidence(),
    ...historicalGoodsKeyModelEvidenceExpansion1(),
  ];
  const evidenceIndex = evidenceByGoodsKey(evidenceRows);

  const rows = identity.rows
    .map((candidate): HistoricalGoodsKeyModelCrosswalkRow => {
      const currentGoodsKeys = [...candidate.goodsKeys].sort();
      const evidence = currentGoodsKeys
        .flatMap((goodsKey) => evidenceIndex.get(goodsKey) ?? [])
        .sort(
          (left, right) =>
            left.goodsKey.localeCompare(right.goodsKey) ||
            left.originalModelNo.localeCompare(right.originalModelNo),
        );
      const evidencedGoodsKeys = [
        ...new Set(evidence.map((row) => text(row.goodsKey))),
      ].sort();
      const conflictingGoodsKeys = currentGoodsKeys
        .filter((goodsKey) => conflictFor(evidenceIndex.get(goodsKey) ?? []))
        .sort();
      const uncoveredGoodsKeys = currentGoodsKeys.filter(
        (goodsKey) => !evidencedGoodsKeys.includes(goodsKey),
      );
      const originalModelNos = [
        ...new Set(evidence.map((row) => text(row.originalModelNo).toLowerCase())),
      ].sort();
      const pricingCrossMatchModelNos = [
        ...new Set(
          evidence
            .map((row) => text(row.pricingCrossMatchModelNo).toLowerCase())
            .filter(Boolean),
        ),
      ].sort();
      const fullCoverage =
        currentGoodsKeys.length > 0 && uncoveredGoodsKeys.length === 0;
      const state: HistoricalGoodsKeyModelCrosswalkState =
        currentGoodsKeys.length === 0
          ? "NO_ACTIVE_LISTING"
          : conflictingGoodsKeys.length > 0
            ? "MODEL_CONFLICT"
            : evidencedGoodsKeys.length === 0
              ? "NO_EVIDENCE"
              : !fullCoverage
                ? "PARTIAL_COVERAGE"
                : originalModelNos.length === 1
                  ? "SINGLE_MODEL_FULL_COVERAGE"
                  : "MULTI_MODEL_FULL_COVERAGE";
      const coveragePct = currentGoodsKeys.length
        ? Math.round((evidencedGoodsKeys.length / currentGoodsKeys.length) * 10_000) / 100
        : 0;

      return {
        barcode: candidate.barcode,
        productName: candidate.productName,
        currentGoodsKeys,
        evidencedGoodsKeys,
        uncoveredGoodsKeys,
        conflictingGoodsKeys,
        originalModelNos,
        pricingCrossMatchModelNos,
        state,
        coveragePct,
        singleModelFullCoverageCandidate:
          state === "SINGLE_MODEL_FULL_COVERAGE",
        historicalOrderAggregationAllowed: false,
        inventoryUseAllowed: false,
        inventoryPromotionAllowed: false,
        purchaseWritesEnabled: false,
        inventoryWritesEnabled: false,
        shoplingWritesEnabled: false,
        evidence,
      };
    })
    .sort(
      (left, right) =>
        statePriority(left.state) - statePriority(right.state) ||
        right.coveragePct - left.coveragePct ||
        left.barcode.localeCompare(right.barcode),
    );

  const ready = identity.state === "READY_READ_ONLY" && rows.length > 0;
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    currentGoodsKeys: row.currentGoodsKeys,
    evidencedGoodsKeys: row.evidencedGoodsKeys,
    uncoveredGoodsKeys: row.uncoveredGoodsKeys,
    conflictingGoodsKeys: row.conflictingGoodsKeys,
    originalModelNos: row.originalModelNos,
    pricingCrossMatchModelNos: row.pricingCrossMatchModelNos,
    state: row.state,
    coveragePct: row.coveragePct,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_READ_ONLY" : "BLOCKED",
    message: ready
      ? "현재 발주후보의 전체 활성 Shopling goods_key 집합을 과거 원본 모델번호 증거와 교차검증합니다. 일부 goods_key만 맞는 경우 PARTIAL_COVERAGE, 한 B-code 안에 여러 원본 aaa 모델이 실제로 존재하면 MULTI_MODEL_FULL_COVERAGE로 구분합니다. 가격 계산용 교차매칭 모델번호는 원본 모델번호와 별도 필드로 보존하며 어떤 결과도 재고나 과거 발주수량으로 자동 승격하지 않습니다."
      : "Shopling 식별자 집합이 준비되지 않아 과거 모델번호 교차검증을 차단합니다.",
    purchaseCandidateCount: rows.length,
    evidenceRecordCount: evidenceRows.length,
    evidenceGoodsKeyCount: new Set(evidenceRows.map((row) => row.goodsKey)).size,
    singleModelFullCoverageCount: rows.filter(
      (row) => row.state === "SINGLE_MODEL_FULL_COVERAGE",
    ).length,
    multiModelFullCoverageCount: rows.filter(
      (row) => row.state === "MULTI_MODEL_FULL_COVERAGE",
    ).length,
    partialCoverageCount: rows.filter((row) => row.state === "PARTIAL_COVERAGE").length,
    noEvidenceCount: rows.filter((row) => row.state === "NO_EVIDENCE").length,
    modelConflictCount: rows.filter((row) => row.state === "MODEL_CONFLICT").length,
    noActiveListingCount: rows.filter((row) => row.state === "NO_ACTIVE_LISTING").length,
    fingerprint: sha256({
      identityFingerprint: identity.fingerprint,
      evidence: evidenceRows,
      rows: stable,
    }),
    historicalOrderAggregationAllowed: false,
    inventoryUseAllowed: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    shoplingWritesEnabled: false,
    rows,
  };
}

function statePriority(state: HistoricalGoodsKeyModelCrosswalkState) {
  if (state === "SINGLE_MODEL_FULL_COVERAGE") return 0;
  if (state === "MULTI_MODEL_FULL_COVERAGE") return 1;
  if (state === "PARTIAL_COVERAGE") return 2;
  if (state === "MODEL_CONFLICT") return 3;
  if (state === "NO_EVIDENCE") return 4;
  return 5;
}
