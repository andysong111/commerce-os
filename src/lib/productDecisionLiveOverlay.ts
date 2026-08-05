import type {
  ProductDecisionRow,
  ProductDecisionSnapshot,
} from "@/lib/productDecisionSnapshot";

export type ProductDecisionInventoryRow = {
  barcode: string;
  estimatedQuantity: number;
  confirmed: boolean;
  requiresReview?: boolean;
};

export type ProductDecisionLiveOverlaySummary = {
  applied: boolean;
  productCount: number;
  confirmedInventoryCount: number;
  commitmentBarcodeCount: number;
  changedProductCount: number;
  zeroNeedCount: number;
  inventoryGeneratedAt: string | null;
  inventoryError: string | null;
  commitmentError: string | null;
};

export type ProductDecisionLiveOverlayResult = {
  snapshot: ProductDecisionSnapshot;
  summary: ProductDecisionLiveOverlaySummary;
};

function normalizeBarcode(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function inventoryMap(rows: ProductDecisionInventoryRow[]) {
  const result = new Map<string, ProductDecisionInventoryRow>();
  for (const row of rows) {
    const barcode = normalizeBarcode(row.barcode);
    if (!barcode) continue;
    const current = result.get(barcode);
    const candidate = {
      ...row,
      barcode,
      estimatedQuantity: quantity(row.estimatedQuantity),
      confirmed: Boolean(row.confirmed && !row.requiresReview),
    };
    if (!current || (!current.confirmed && candidate.confirmed)) {
      result.set(barcode, candidate);
    }
  }
  return result;
}

function applyRow(
  product: ProductDecisionRow,
  inventories: Map<string, ProductDecisionInventoryRow>,
  commitments: Map<string, number>,
) {
  const barcode = normalizeBarcode(product.barcode);
  const inventory = inventories.get(barcode);
  const inventoryKnown = Boolean(inventory?.confirmed);
  const estimatedStock = inventoryKnown
    ? quantity(inventory?.estimatedQuantity)
    : 0;
  const openCommitment = quantity(commitments.get(barcode));
  const demandTarget = quantity(
    product.rawRecommendedQty ?? product.recommendedQty,
  );
  const securedQuantity = estimatedStock + openCommitment;
  const netRequiredRaw = Math.max(0, demandTarget - securedQuantity);
  const changed =
    Boolean(product.inventoryKnown) !== inventoryKnown ||
    quantity(product.estimatedStock) !== estimatedStock ||
    quantity(product.openCommitment) !== openCommitment ||
    quantity(product.securedQuantity) !== securedQuantity ||
    quantity(product.netRequiredRaw) !== netRequiredRaw;

  return {
    product: {
      ...product,
      barcode,
      rawRecommendedQty: demandTarget,
      inventoryKnown,
      estimatedStock,
      openCommitment,
      securedQuantity,
      netRequiredRaw,
    } satisfies ProductDecisionRow,
    changed,
    zeroNeed: demandTarget > 0 && netRequiredRaw === 0,
  };
}

/**
 * 검증된 판매 수요 목표에 현재 상품마스터 확인재고와 중국 미입고 원장을
 * 덧씌운다. MOQ·박스입수·포트폴리오 예산을 다시 계산하지 않으므로 기존
 * recommendedQty와 expectedCost는 기준 발주안 값으로 보존한다.
 */
export function applyProductDecisionLiveOverlay(
  snapshot: ProductDecisionSnapshot,
  inventoryRows: ProductDecisionInventoryRow[],
  commitments: Map<string, number>,
  options: {
    inventoryGeneratedAt?: string | null;
    inventoryError?: string | null;
    commitmentError?: string | null;
  } = {},
): ProductDecisionLiveOverlayResult {
  const inventories = inventoryMap(inventoryRows);
  const applied = (snapshot.products ?? []).map((product) =>
    applyRow(product, inventories, commitments),
  );
  const inventoryGeneratedAt = String(
    options.inventoryGeneratedAt ?? "",
  ).trim();

  return {
    snapshot: {
      ...snapshot,
      notice: [
        snapshot.notice,
        "판매 수요 목표는 검증 기준 발주안이며, 추정재고·진행발주·신규필요는 현재 상품마스터와 중국 미입고 원장으로 갱신했습니다.",
      ]
        .filter(Boolean)
        .join(" "),
      products: applied.map((row) => row.product),
    },
    summary: {
      applied:
        inventories.size > 0 ||
        commitments.size > 0 ||
        Boolean(options.inventoryError || options.commitmentError),
      productCount: applied.length,
      confirmedInventoryCount: [...inventories.values()].filter(
        (row) => row.confirmed,
      ).length,
      commitmentBarcodeCount: [...commitments.values()].filter(
        (value) => quantity(value) > 0,
      ).length,
      changedProductCount: applied.filter((row) => row.changed).length,
      zeroNeedCount: applied.filter((row) => row.zeroNeed).length,
      inventoryGeneratedAt: inventoryGeneratedAt || null,
      inventoryError: options.inventoryError ?? null,
      commitmentError: options.commitmentError ?? null,
    },
  };
}
