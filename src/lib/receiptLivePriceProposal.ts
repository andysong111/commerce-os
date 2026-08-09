import { createHash } from "node:crypto";
import {
  PRICE_GRADE_RULE_VERSION,
  calculateProductPriceGrade,
} from "@/lib/priceGradeEngine";
import type { PriceGradeShadowInput } from "@/lib/priceGradeShadowComparison";
import type {
  ConfirmedReceiptBatchRow,
  ConfirmedReceiptBatchSource,
} from "@/lib/confirmedReceiptBatchSource";
import type {
  ShoplingCurrentPriceListing,
  ShoplingCurrentPriceSnapshot,
} from "@/lib/shopling/shoplingCurrentPriceResolver";
import type { PlanningProduct } from "@/lib/shopling/shoplingLiveAggregation";

export type ReceiptLivePriceEvent = {
  eventId: string;
  receiptId: string;
  batchId: number;
  occurredAt: string;
  barcodes: string[];
  totals: {
    good: number;
    damaged: number;
    missing: number;
  };
};

export type ReceiptLivePriceListingProposal = {
  barcode: string;
  skuId: string;
  productName: string;
  optionName: string | null;
  goodsKey: string;
  optionId: string;
  productGroup: string;
  ptnGoodsCd: string;
  currentBaseSalePrice: number;
  currentOptionAmount: number;
  currentEffectiveSalePrice: number;
  latestBatchQuantity: number;
  latestBatchUnitCostKrw: number;
  latestBatchReceivedAt: string;
  protectionCostKrw: number;
  marginFloorPrice: number;
  decision: string;
  grade: number;
  targetEffectiveSalePrice: number;
  adjustmentBps: number;
  priceChangeRequired: boolean;
  blockedReasons: string[];
  reasons: string[];
};

export type ReceiptLivePriceGoodsKeyProposal = {
  goodsKey: string;
  ptnGoodsCd: string;
  productGroup: string;
  ownerBarcodes: string[];
  eventBarcodes: string[];
  plannedBarcodes: string[];
  listingCount: number;
  changedListingCount: number;
  adjustmentBps: number | null;
  canaryEligible: boolean;
  blockedReason: string | null;
};

export type ReceiptLivePriceProposal = {
  generatedAt: string;
  state: "READY" | "PARTIAL" | "NO_CHANGE" | "BLOCKED";
  message: string;
  eventId: string;
  receiptId: string;
  batchId: number;
  eventOccurredAt: string;
  sourceMode: ConfirmedReceiptBatchSource["sourceMode"];
  exactReceiptRowCount: number;
  exactReceiptBarcodeCount: number;
  eventBarcodeCount: number;
  priceInputCount: number;
  planningProductCount: number;
  livePriceReadyCount: number;
  livePriceMissingCount: number;
  livePriceConflictCount: number;
  listingProposalCount: number;
  changedListingCount: number;
  eligibleGoodsKeyCount: number;
  blockedGoodsKeyCount: number;
  priceRuleVersion: string;
  currentPriceSource: "SHOPLING_LIVE_PRODUCT_LOOKUP";
  receiptCostSource: "EXACT_CONFIRMED_BATCH_PLUS_HISTORY";
  fingerprint: string;
  writesEnabled: false;
  listingProposals: ReceiptLivePriceListingProposal[];
  goodsKeyProposals: ReceiptLivePriceGoodsKeyProposal[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcodeKey(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function timestamp(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function adjustmentBps(currentPrice: number, targetPrice: number) {
  if (!(currentPrice > 0) || !(targetPrice > 0)) return 0;
  return Math.round(((targetPrice / currentPrice) - 1) * 10_000);
}

function aggregateBatchReceipts(rows: ConfirmedReceiptBatchRow[]) {
  const grouped = new Map<
    string,
    {
      barcode: string;
      quantity: number;
      unitCostKrw: number;
      receivedAt: string;
    }
  >();
  for (const row of rows) {
    const barcode = barcodeKey(row.barcode);
    if (!barcode) continue;
    const current = grouped.get(barcode);
    const receivedAt = text(row.receivedAt);
    if (!current) {
      grouped.set(barcode, {
        barcode,
        quantity: integer(row.quantity),
        unitCostKrw: integer(row.unitCostKrw),
        receivedAt,
      });
      continue;
    }
    current.quantity += integer(row.quantity);
    current.unitCostKrw = Math.max(current.unitCostKrw, integer(row.unitCostKrw));
    if ((timestamp(receivedAt) ?? 0) > (timestamp(current.receivedAt) ?? 0)) {
      current.receivedAt = receivedAt;
    }
  }
  return grouped;
}

function mergeReceiptHistory(
  input: PriceGradeShadowInput,
  current: { receivedAt: string; unitCostKrw: number; quantity: number },
) {
  const all = [
    {
      receivedAt: current.receivedAt,
      unitCostKrw: current.unitCostKrw,
      quantity: current.quantity,
    },
    ...(input.receipts ?? []),
  ];
  const unique = new Map<string, (typeof all)[number]>();
  for (const row of all) {
    const receivedAt = text(row.receivedAt);
    const unitCostKrw = integer(row.unitCostKrw);
    const quantity = integer(row.quantity ?? 0);
    if (!receivedAt || !unitCostKrw) continue;
    const key = `${receivedAt}|${unitCostKrw}|${quantity}`;
    unique.set(key, { receivedAt, unitCostKrw, quantity });
  }
  return [...unique.values()].sort(
    (left, right) =>
      (timestamp(right.receivedAt) ?? 0) - (timestamp(left.receivedAt) ?? 0) ||
      right.unitCostKrw - left.unitCostKrw,
  );
}

function activeGoodsKeyOwners(products: PlanningProduct[]) {
  const owners = new Map<string, Set<string>>();
  for (const product of products) {
    if (product.skuActive === false) continue;
    const barcode = barcodeKey(product.barcode);
    if (!barcode) continue;
    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      const goodsKey = text(listing.goodsKey);
      if (!goodsKey) continue;
      const set = owners.get(goodsKey) ?? new Set<string>();
      set.add(barcode);
      owners.set(goodsKey, set);
    }
  }
  return owners;
}

function listingProposal(input: {
  priceInput: PriceGradeShadowInput;
  listing: ShoplingCurrentPriceListing;
  currentBatch: {
    quantity: number;
    unitCostKrw: number;
    receivedAt: string;
  };
  generatedAt: string;
}): ReceiptLivePriceListingProposal {
  const receipts = mergeReceiptHistory(input.priceInput, input.currentBatch);
  const result = calculateProductPriceGrade({
    barcode: input.priceInput.barcode,
    currentPrice: input.listing.effectiveSalePrice,
    currentGrade: input.priceInput.currentGrade,
    launchedAt: input.priceInput.launchedAt,
    lastSaleAt: input.priceInput.lastSaleAt,
    monthlyUnits: input.priceInput.monthlyUnits,
    receipts,
    discontinued: input.priceInput.discontinued,
    active: input.priceInput.active,
    markdownStage: input.priceInput.markdownStage,
    asOf: input.generatedAt,
  });
  const bps = adjustmentBps(
    input.listing.effectiveSalePrice,
    result.recommendedPrice,
  );
  return {
    barcode: barcodeKey(input.priceInput.barcode),
    skuId: input.priceInput.skuId,
    productName: input.priceInput.productName,
    optionName: input.priceInput.optionName ?? null,
    goodsKey: input.listing.goodsKey,
    optionId: input.listing.optionId,
    productGroup: input.listing.productGroup,
    ptnGoodsCd: input.listing.ptnGoodsCd,
    currentBaseSalePrice: input.listing.baseSalePrice,
    currentOptionAmount: input.listing.optionAmount,
    currentEffectiveSalePrice: input.listing.effectiveSalePrice,
    latestBatchQuantity: input.currentBatch.quantity,
    latestBatchUnitCostKrw: input.currentBatch.unitCostKrw,
    latestBatchReceivedAt: input.currentBatch.receivedAt,
    protectionCostKrw: result.protectionCost,
    marginFloorPrice: result.marginFloorPrice,
    decision: result.decision,
    grade: result.grade,
    targetEffectiveSalePrice: result.recommendedPrice,
    adjustmentBps: bps,
    priceChangeRequired:
      result.blockedReasons.length === 0 &&
      result.recommendedPrice !== input.listing.effectiveSalePrice,
    blockedReasons: result.blockedReasons,
    reasons: result.reasons,
  };
}

function buildGoodsKeyProposals(input: {
  listingProposals: ReceiptLivePriceListingProposal[];
  planningProducts: PlanningProduct[];
  eventBarcodes: Set<string>;
}) {
  const owners = activeGoodsKeyOwners(input.planningProducts);
  const grouped = new Map<string, ReceiptLivePriceListingProposal[]>();
  for (const row of input.listingProposals) {
    const rows = grouped.get(row.goodsKey) ?? [];
    rows.push(row);
    grouped.set(row.goodsKey, rows);
  }
  return [...grouped.entries()]
    .map(([goodsKey, rows]): ReceiptLivePriceGoodsKeyProposal => {
      const ownerBarcodes = [...(owners.get(goodsKey) ?? new Set<string>())].sort();
      const plannedBarcodes = [...new Set(rows.map((row) => row.barcode))].sort();
      const eventBarcodes = ownerBarcodes.filter((barcode) => input.eventBarcodes.has(barcode));
      const changed = rows.filter((row) => row.priceChangeRequired);
      const blockedRows = rows.filter((row) => row.blockedReasons.length > 0);
      const bps = [...new Set(changed.map((row) => row.adjustmentBps))];
      const unaffectedOwners = ownerBarcodes.filter(
        (barcode) => !input.eventBarcodes.has(barcode),
      );
      const unplannedOwners = ownerBarcodes.filter(
        (barcode) => !plannedBarcodes.includes(barcode),
      );
      let blockedReason: string | null = null;
      if (!ownerBarcodes.length) {
        blockedReason = "GOODS_KEY_OWNER_MISSING";
      } else if (unaffectedOwners.length) {
        blockedReason = `GOODS_KEY_SHARED_WITH_UNAFFECTED:${unaffectedOwners.join(",")}`;
      } else if (unplannedOwners.length) {
        blockedReason = `GOODS_KEY_OWNER_PLAN_MISSING:${unplannedOwners.join(",")}`;
      } else if (blockedRows.length) {
        blockedReason = "PRICE_ENGINE_BLOCKED_LISTING";
      } else if (bps.length > 1) {
        blockedReason = "GOODS_KEY_ADJUSTMENT_CONFLICT";
      }
      const canaryEligible =
        changed.length > 0 &&
        bps.length === 1 &&
        ownerBarcodes.length > 0 &&
        unaffectedOwners.length === 0 &&
        unplannedOwners.length === 0 &&
        blockedRows.length === 0 &&
        blockedReason === null;
      return {
        goodsKey,
        ptnGoodsCd: rows.map((row) => row.ptnGoodsCd).find(Boolean) ?? "",
        productGroup: rows.map((row) => row.productGroup).find(Boolean) ?? "",
        ownerBarcodes,
        eventBarcodes,
        plannedBarcodes,
        listingCount: rows.length,
        changedListingCount: changed.length,
        adjustmentBps: canaryEligible ? bps[0] : null,
        canaryEligible,
        blockedReason,
      };
    })
    .sort((left, right) => Number(left.goodsKey) - Number(right.goodsKey));
}

export function buildReceiptLivePriceProposal(input: {
  event: ReceiptLivePriceEvent;
  receiptSource: ConfirmedReceiptBatchSource;
  priceInputs: PriceGradeShadowInput[];
  planningProducts: PlanningProduct[];
  livePrices: ShoplingCurrentPriceSnapshot;
  generatedAt?: string;
}): ReceiptLivePriceProposal {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const eventBarcodes = new Set(input.event.barcodes.map(barcodeKey).filter(Boolean));
  const sourceRows = input.receiptSource.rows;
  if (input.receiptSource.batchId !== input.event.batchId) {
    throw new Error("RECEIPT_PROPOSAL_BATCH_SOURCE_MISMATCH");
  }
  const foreignSourceBarcode = sourceRows
    .map((row) => barcodeKey(row.barcode))
    .find((barcode) => barcode && !eventBarcodes.has(barcode));
  if (foreignSourceBarcode) {
    throw new Error(`RECEIPT_PROPOSAL_FOREIGN_BARCODE:${foreignSourceBarcode}`);
  }
  if (integer(input.event.totals.good) > 0 && !sourceRows.length) {
    throw new Error("RECEIPT_PROPOSAL_GOOD_RECEIPT_SOURCE_EMPTY");
  }

  const currentBatchByBarcode = aggregateBatchReceipts(sourceRows);
  const affectedBarcodes = new Set(currentBatchByBarcode.keys());
  const priceByBarcode = new Map(
    input.priceInputs.map((row) => [barcodeKey(row.barcode), row]),
  );
  const liveByBarcode = new Map(
    input.livePrices.rows.map((row) => [barcodeKey(row.barcode), row]),
  );
  const listingProposals: ReceiptLivePriceListingProposal[] = [];

  for (const barcode of [...affectedBarcodes].sort()) {
    const priceInput = priceByBarcode.get(barcode);
    const batch = currentBatchByBarcode.get(barcode);
    const live = liveByBarcode.get(barcode);
    if (!priceInput || !batch || !live || live.state !== "READY") continue;
    for (const listing of live.listings) {
      listingProposals.push(
        listingProposal({
          priceInput,
          listing,
          currentBatch: batch,
          generatedAt,
        }),
      );
    }
  }
  listingProposals.sort(
    (left, right) =>
      left.barcode.localeCompare(right.barcode) ||
      Number(left.goodsKey) - Number(right.goodsKey) ||
      left.optionId.localeCompare(right.optionId),
  );

  const goodsKeyProposals = buildGoodsKeyProposals({
    listingProposals,
    planningProducts: input.planningProducts,
    eventBarcodes: affectedBarcodes,
  });
  const changedListingCount = listingProposals.filter(
    (row) => row.priceChangeRequired,
  ).length;
  const eligibleGoodsKeyCount = goodsKeyProposals.filter(
    (row) => row.canaryEligible,
  ).length;
  const blockedGoodsKeyCount = goodsKeyProposals.filter(
    (row) => row.changedListingCount > 0 && !row.canaryEligible,
  ).length;
  const missingPriceInputs = [...affectedBarcodes].filter(
    (barcode) => !priceByBarcode.has(barcode),
  );
  const missingLive = [...affectedBarcodes].filter((barcode) => {
    const row = liveByBarcode.get(barcode);
    return !row || row.state !== "READY";
  });
  const structuralBlocked = missingPriceInputs.length > 0 || missingLive.length > 0;
  const state: ReceiptLivePriceProposal["state"] = structuralBlocked
    ? eligibleGoodsKeyCount > 0
      ? "PARTIAL"
      : "BLOCKED"
    : changedListingCount === 0
      ? "NO_CHANGE"
      : blockedGoodsKeyCount > 0
        ? eligibleGoodsKeyCount > 0
          ? "PARTIAL"
          : "BLOCKED"
        : "READY";

  const stable = {
    eventId: input.event.eventId,
    receiptId: input.event.receiptId,
    batchId: input.event.batchId,
    sourceMode: input.receiptSource.sourceMode,
    sourceRows: sourceRows.map((row) => ({
      id: row.id,
      barcode: row.barcode,
      quantity: row.quantity,
      unitCostKrw: row.unitCostKrw,
      receivedAt: row.receivedAt,
    })),
    listingProposals: listingProposals.map((row) => ({
      barcode: row.barcode,
      goodsKey: row.goodsKey,
      optionId: row.optionId,
      currentEffectiveSalePrice: row.currentEffectiveSalePrice,
      latestBatchUnitCostKrw: row.latestBatchUnitCostKrw,
      targetEffectiveSalePrice: row.targetEffectiveSalePrice,
      adjustmentBps: row.adjustmentBps,
      priceChangeRequired: row.priceChangeRequired,
    })),
    goodsKeyProposals,
  };

  return {
    generatedAt,
    state,
    message:
      state === "READY"
        ? "확정입고 batch의 원가·수량과 현재 Shopling 판매가를 결합해 안전한 goods_key 가격변경 카나리 후보를 만들었습니다. 실제 가격 write는 아직 차단됩니다."
        : state === "NO_CHANGE"
          ? "확정입고 원가를 반영해 다시 계산했지만 현재 Shopling 판매가를 변경할 필요가 없습니다."
          : state === "PARTIAL"
            ? "일부 goods_key는 카나리 후보가 준비됐지만 매핑·현재가·공유 goods_key 안전조건 때문에 나머지는 차단했습니다."
            : "확정입고 재가격 후보를 계산했지만 안전조건을 만족하는 goods_key가 없어 실제 가격변경을 차단합니다.",
    eventId: input.event.eventId,
    receiptId: input.event.receiptId,
    batchId: input.event.batchId,
    eventOccurredAt: input.event.occurredAt,
    sourceMode: input.receiptSource.sourceMode,
    exactReceiptRowCount: sourceRows.length,
    exactReceiptBarcodeCount: affectedBarcodes.size,
    eventBarcodeCount: eventBarcodes.size,
    priceInputCount: input.priceInputs.length,
    planningProductCount: input.planningProducts.length,
    livePriceReadyCount: input.livePrices.readyCount,
    livePriceMissingCount: input.livePrices.missingCount,
    livePriceConflictCount: input.livePrices.conflictCount,
    listingProposalCount: listingProposals.length,
    changedListingCount,
    eligibleGoodsKeyCount,
    blockedGoodsKeyCount,
    priceRuleVersion: PRICE_GRADE_RULE_VERSION,
    currentPriceSource: "SHOPLING_LIVE_PRODUCT_LOOKUP",
    receiptCostSource: "EXACT_CONFIRMED_BATCH_PLUS_HISTORY",
    fingerprint: fingerprint(stable),
    writesEnabled: false,
    listingProposals,
    goodsKeyProposals,
  };
}
