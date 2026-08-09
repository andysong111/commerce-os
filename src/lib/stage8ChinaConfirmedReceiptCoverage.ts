import { createHash } from "node:crypto";
import { loadConfirmedReceiptHistorySource } from "@/lib/confirmedReceiptHistorySource";
import { loadProductMasterInventoryCostReadiness } from "@/lib/productMasterInventoryCostReadiness";
import { loadPurchaseCandidateShoplingIdentityAudit } from "@/lib/stage8PurchaseCandidateShoplingIdentityAudit";

export type ChinaConfirmedReceiptCoverageState =
  | "PARITY"
  | "SOURCE_SYNC_GAP"
  | "QUANTITY_MISMATCH"
  | "NO_CONFIRMED_RECEIPT";

export type ChinaConfirmedReceiptCoverageRow = {
  barcode: string;
  productName: string;
  chinaReceiptRowCount: number;
  chinaReceiptQuantity: number;
  chinaReceiptBatchIds: number[];
  chinaReceiptModelNumbers: string[];
  firstChinaReceiptAt: string | null;
  latestChinaReceiptAt: string | null;
  latestChinaUnitCostKrw: number;
  maxChinaUnitCostKrw: number;
  productMasterReceiptQuantity: number;
  productMasterReceiptRowCount: number;
  productMasterHasConfirmedReceiptCost: boolean;
  state: ChinaConfirmedReceiptCoverageState;
  message: string;
  receiptEvidenceUsableForCostAudit: boolean;
  currentInventoryPromotionAllowed: false;
  purchaseDecisionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

export type ChinaConfirmedReceiptCoverage = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  message: string;
  sourceMode: string;
  sourcePageCount: number;
  sourceReceiptRowCount: number;
  sourceReceiptQuantity: number;
  targetedBarcodeCount: number;
  foreignBarcodeRowCount: 0;
  purchaseCandidateCount: number;
  candidateWithChinaReceiptCount: number;
  candidateWithProductMasterReceiptCount: number;
  parityCount: number;
  sourceSyncGapCount: number;
  quantityMismatchCount: number;
  noConfirmedReceiptCount: number;
  fingerprint: string;
  sourceWritesEnabled: false;
  currentInventoryPromotionAllowed: false;
  purchaseDecisionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: ChinaConfirmedReceiptCoverageRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadChinaConfirmedReceiptCoverage(): Promise<ChinaConfirmedReceiptCoverage> {
  const [candidates, productMaster] = await Promise.all([
    loadPurchaseCandidateShoplingIdentityAudit(),
    loadProductMasterInventoryCostReadiness(),
  ]);
  const candidateBarcodeList = candidates.rows
    .map((row) => barcode(row.barcode))
    .filter(Boolean)
    .sort();
  if (!candidateBarcodeList.length) {
    throw new Error("CHINA_RECEIPT_COVERAGE_CANDIDATE_SCOPE_EMPTY");
  }
  const candidateBarcodes = new Set(candidateBarcodeList);
  const source = await loadConfirmedReceiptHistorySource(candidateBarcodeList);
  const filteredBarcodes = source.filter.barcodes;
  if (
    filteredBarcodes.length !== candidateBarcodeList.length ||
    filteredBarcodes.some((value, index) => value !== candidateBarcodeList[index])
  ) {
    throw new Error("CHINA_RECEIPT_COVERAGE_FILTER_SCOPE_MISMATCH");
  }
  const foreignBarcodeRows = source.rows.filter(
    (row) => !candidateBarcodes.has(barcode(row.barcode)),
  );
  if (foreignBarcodeRows.length) {
    throw new Error("CHINA_RECEIPT_COVERAGE_FOREIGN_BARCODE");
  }

  const pmByBarcode = new Map(
    productMaster.rows.map((row) => [barcode(row.barcode), row] as const),
  );
  const sourceByBarcode = new Map<string, typeof source.rows>();
  for (const receipt of source.rows) {
    const key = barcode(receipt.barcode);
    sourceByBarcode.set(key, [...(sourceByBarcode.get(key) ?? []), receipt]);
  }

  const rows = candidates.rows
    .map((candidate): ChinaConfirmedReceiptCoverageRow => {
      const key = barcode(candidate.barcode);
      const receipts = [...(sourceByBarcode.get(key) ?? [])].sort(
        (left, right) =>
          Date.parse(left.receivedAt) - Date.parse(right.receivedAt) ||
          left.id.localeCompare(right.id),
      );
      const pm = pmByBarcode.get(key);
      const chinaReceiptQuantity = receipts.reduce(
        (sum, row) => sum + positiveNumber(row.quantity),
        0,
      );
      const productMasterReceiptQuantity = positiveNumber(
        pm?.receiptQuantityTotal,
      );
      const latest = receipts.at(-1) ?? null;
      const state: ChinaConfirmedReceiptCoverageState =
        chinaReceiptQuantity > 0 && productMasterReceiptQuantity === 0
          ? "SOURCE_SYNC_GAP"
          : chinaReceiptQuantity > 0 &&
              productMasterReceiptQuantity > 0 &&
              Math.abs(chinaReceiptQuantity - productMasterReceiptQuantity) > 1e-9
            ? "QUANTITY_MISMATCH"
            : chinaReceiptQuantity > 0 && productMasterReceiptQuantity > 0
              ? "PARITY"
              : "NO_CONFIRMED_RECEIPT";
      const message =
        state === "SOURCE_SYNC_GAP"
          ? "중국 발주·입고 원장에는 확정입고가 있지만 Product Master receipt 수량이 0이어서 동기화 공백으로 분류합니다. 자동 재고승격은 하지 않습니다."
          : state === "QUANTITY_MISMATCH"
            ? "중국 확정입고 누계와 Product Master receipt 누계가 달라 원인 대조 전까지 사용을 차단합니다."
            : state === "PARITY"
              ? "중국 확정입고 누계와 Product Master receipt 누계가 모두 존재합니다. 이 화면은 수량증거만 검증하며 초기 미확인 재고를 VERIFIED로 만들지 않습니다."
              : "현재 B-code 기준으로 중국 확정입고 원장과 Product Master receipt 양쪽 모두 수량증거가 없습니다.";

      return {
        barcode: key,
        productName: candidate.productName,
        chinaReceiptRowCount: receipts.length,
        chinaReceiptQuantity,
        chinaReceiptBatchIds: [...new Set(receipts.map((row) => row.batchId))].sort(
          (left, right) => left - right,
        ),
        chinaReceiptModelNumbers: [
          ...new Set(receipts.map((row) => text(row.modelNumber)).filter(Boolean)),
        ].sort(),
        firstChinaReceiptAt: receipts[0]?.receivedAt ?? null,
        latestChinaReceiptAt: latest?.receivedAt ?? null,
        latestChinaUnitCostKrw: latest ? positiveNumber(latest.unitCostKrw) : 0,
        maxChinaUnitCostKrw: receipts.reduce(
          (max, row) => Math.max(max, positiveNumber(row.unitCostKrw)),
          0,
        ),
        productMasterReceiptQuantity,
        productMasterReceiptRowCount: Math.max(
          0,
          Math.round(Number(pm?.receiptRowCount ?? pm?.receiptCostCount ?? 0) || 0),
        ),
        productMasterHasConfirmedReceiptCost:
          pm?.hasConfirmedReceiptCost === true,
        state,
        message,
        receiptEvidenceUsableForCostAudit:
          state === "PARITY" || state === "SOURCE_SYNC_GAP",
        currentInventoryPromotionAllowed: false,
        purchaseDecisionAllowed: false,
        purchaseWritesEnabled: false,
        inventoryWritesEnabled: false,
      };
    })
    .sort(
      (left, right) =>
        statePriority(left.state) - statePriority(right.state) ||
        right.chinaReceiptQuantity - left.chinaReceiptQuantity ||
        left.barcode.localeCompare(right.barcode),
    );

  const ready =
    candidates.state === "READY_READ_ONLY" &&
    productMaster.rows.length > 0;
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    chinaReceiptRowCount: row.chinaReceiptRowCount,
    chinaReceiptQuantity: row.chinaReceiptQuantity,
    chinaReceiptBatchIds: row.chinaReceiptBatchIds,
    chinaReceiptModelNumbers: row.chinaReceiptModelNumbers,
    firstChinaReceiptAt: row.firstChinaReceiptAt,
    latestChinaReceiptAt: row.latestChinaReceiptAt,
    latestChinaUnitCostKrw: row.latestChinaUnitCostKrw,
    maxChinaUnitCostKrw: row.maxChinaUnitCostKrw,
    productMasterReceiptQuantity: row.productMasterReceiptQuantity,
    productMasterReceiptRowCount: row.productMasterReceiptRowCount,
    state: row.state,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_READ_ONLY" : "BLOCKED",
    message: ready
      ? "중국 발주·입고 관리의 확정입고 API를 현재 42개 발주후보 B-code로 서버측 필터링해 Product Master receipt 원장과 직접 대조합니다. 전체 입고이력을 훑지 않고 필요한 B-code만 조회하며, 중국 확정입고가 Product Master에 빠져 있다면 SOURCE_SYNC_GAP으로 드러냅니다. 이 감사 자체는 초기 미확인 재고를 VERIFIED로 승격하거나 실제 발주를 실행하지 않습니다."
      : "현재 발주후보 또는 Product Master 원장이 준비되지 않아 확정입고 커버리지 감사를 운영 판단에 사용하지 않습니다.",
    sourceMode: source.sourceMode,
    sourcePageCount: source.pageCount,
    sourceReceiptRowCount: source.rows.length,
    sourceReceiptQuantity: source.rows.reduce(
      (sum, row) => sum + positiveNumber(row.quantity),
      0,
    ),
    targetedBarcodeCount: source.filter.barcodes.length,
    foreignBarcodeRowCount: 0,
    purchaseCandidateCount: rows.length,
    candidateWithChinaReceiptCount: rows.filter(
      (row) => row.chinaReceiptQuantity > 0,
    ).length,
    candidateWithProductMasterReceiptCount: rows.filter(
      (row) => row.productMasterReceiptQuantity > 0,
    ).length,
    parityCount: rows.filter((row) => row.state === "PARITY").length,
    sourceSyncGapCount: rows.filter((row) => row.state === "SOURCE_SYNC_GAP").length,
    quantityMismatchCount: rows.filter(
      (row) => row.state === "QUANTITY_MISMATCH",
    ).length,
    noConfirmedReceiptCount: rows.filter(
      (row) => row.state === "NO_CONFIRMED_RECEIPT",
    ).length,
    fingerprint: sha256({
      sourceMode: source.sourceMode,
      syncedAt: source.syncedAt,
      filter: source.filter,
      productMasterFingerprint: productMaster.contentFingerprint,
      candidateFingerprint: candidates.fingerprint,
      rows: stable,
    }),
    sourceWritesEnabled: false,
    currentInventoryPromotionAllowed: false,
    purchaseDecisionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}

function statePriority(state: ChinaConfirmedReceiptCoverageState) {
  if (state === "SOURCE_SYNC_GAP") return 0;
  if (state === "QUANTITY_MISMATCH") return 1;
  if (state === "PARITY") return 2;
  return 3;
}
