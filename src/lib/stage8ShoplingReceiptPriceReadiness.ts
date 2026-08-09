import { createHash } from "node:crypto";
import {
  PRICE_GRADE_RULE_VERSION,
  calculateProductPriceGrade,
  type ProductPriceGradeResult,
} from "@/lib/priceGradeEngine";
import { loadPriceGradeReceiptAugmentedSnapshot } from "@/lib/priceGradeReceiptCacheShadow";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  loadShoplingCurrentPriceSnapshot,
  type ShoplingCurrentPriceListing,
} from "@/lib/shopling/shoplingCurrentPrice";

export type ReceiptPriceListingPlan = {
  skuId: string;
  barcode: string;
  productName: string;
  optionName: string | null;
  goodsKey: string;
  optionId: string;
  productGroup: string;
  ptnGoodsCd: string;
  currentSalePrice: number;
  productMasterCurrentPrice: number;
  livePriceDiffersFromProductMaster: boolean;
  latestReceiptAt: string | null;
  latestReceiptCostKrw: number;
  protectionCostKrw: number;
  marginFloorPrice: number;
  receiptTriggered: boolean;
  decision: ProductPriceGradeResult["decision"];
  grade: number;
  recommendedPrice: number;
  adjustmentBps: number;
  priceChangeRequired: boolean;
  blockedReasons: string[];
  reasons: string[];
};

export type ReceiptPriceGoodsKeyPlan = {
  goodsKey: string;
  productGroup: string;
  ptnGoodsCd: string;
  listingCount: number;
  receiptTriggeredListingCount: number;
  priceChangeListingCount: number;
  adjustmentBps: number | null;
  automaticApplyEligible: boolean;
  blockedReason: string | null;
  barcodes: string[];
  ownerBarcodes: string[];
  unaffectedOwnerBarcodes: string[];
  unplannedOwnerBarcodes: string[];
};

export type ShoplingReceiptPriceReadiness = {
  generatedAt: string;
  state: "READY" | "PARTIAL" | "BLOCKED";
  message: string;
  currentPriceSource: "SHOPLING_LIVE_PRODUCT_LOOKUP";
  receiptCostSource: "PRODUCT_MASTER_WITH_RECEIPT_CACHE_FALLBACK";
  shoplingLookupMode: "RECEIPT_AFFECTED_ONLY";
  shoplingLookupSkipped: boolean;
  priceRuleVersion: string;
  inputCount: number;
  affectedInputCount: number;
  affectedBarcodeCount: number;
  affectedPlanningProductCount: number;
  affectedPlanningMissingCount: number;
  affectedGoodsKeyCount: number;
  queriedGoodsKeyCount: number;
  sourceRowCount: number;
  livePriceReadyCount: number;
  livePriceMissingCount: number;
  livePriceConflictCount: number;
  listingPlanCount: number;
  receiptTriggeredListingCount: number;
  priceChangeListingCount: number;
  eligibleGoodsKeyCount: number;
  blockedGoodsKeyCount: number;
  fingerprint: string;
  writesEnabled: false;
  listingPlans: ReceiptPriceListingPlan[];
  goodsKeyPlans: ReceiptPriceGoodsKeyPlan[];
};

type PriceInput = Awaited<
  ReturnType<typeof loadPriceGradeReceiptAugmentedSnapshot>
>["snapshot"]["inputs"][number];

type PlanningProduct = Awaited<
  ReturnType<typeof loadProductPlanningSnapshot>
>["products"][number];

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

function latestReceipt(input: {
  receipts?: Array<{ receivedAt: string; unitCostKrw: number }>;
}) {
  return (
    [...(input.receipts ?? [])]
      .filter(
        (row) =>
          timestamp(row.receivedAt) !== null && integer(row.unitCostKrw) > 0,
      )
      .sort(
        (left, right) =>
          (timestamp(right.receivedAt) ?? 0) -
          (timestamp(left.receivedAt) ?? 0),
      )[0] ?? null
  );
}

function receiptTriggered(
  latestReceiptAt: string | null,
  lifecycleCalculatedAt: string | null | undefined,
) {
  const receiptAt = timestamp(latestReceiptAt);
  if (receiptAt === null) return false;
  const lifecycleAt = timestamp(lifecycleCalculatedAt);
  return lifecycleAt === null || receiptAt > lifecycleAt;
}

function receiptTriggeredInput(input: PriceInput) {
  const receipt = latestReceipt(input);
  return receiptTriggered(
    receipt?.receivedAt ?? null,
    input.existingLifecycle?.calculatedAt,
  );
}

function adjustmentBps(result: ProductPriceGradeResult) {
  return Math.round(result.adjustmentRate * 10_000);
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function listingPlan(
  input: PriceInput,
  listing: ShoplingCurrentPriceListing,
  generatedAt: string,
): ReceiptPriceListingPlan {
  const receipt = latestReceipt(input);
  const triggered = receiptTriggered(
    receipt?.receivedAt ?? null,
    input.existingLifecycle?.calculatedAt,
  );
  const result = calculateProductPriceGrade({
    barcode: input.barcode,
    currentPrice: listing.effectiveSalePrice,
    currentGrade: input.currentGrade,
    launchedAt: input.launchedAt,
    lastSaleAt: input.lastSaleAt,
    monthlyUnits: input.monthlyUnits,
    receipts: input.receipts,
    discontinued: input.discontinued,
    active: input.active,
    markdownStage: input.markdownStage,
    asOf: generatedAt,
  });
  return {
    skuId: input.skuId,
    barcode: barcodeKey(input.barcode),
    productName: input.productName,
    optionName: input.optionName ?? null,
    goodsKey: listing.goodsKey,
    optionId: listing.optionId,
    productGroup: listing.productGroup,
    ptnGoodsCd: listing.ptnGoodsCd,
    currentSalePrice: listing.effectiveSalePrice,
    productMasterCurrentPrice: integer(input.currentPrice),
    livePriceDiffersFromProductMaster:
      integer(input.currentPrice) !== listing.effectiveSalePrice,
    latestReceiptAt: receipt?.receivedAt ?? null,
    latestReceiptCostKrw: integer(receipt?.unitCostKrw),
    protectionCostKrw: result.protectionCost,
    marginFloorPrice: result.marginFloorPrice,
    receiptTriggered: triggered,
    decision: result.decision,
    grade: result.grade,
    recommendedPrice: result.recommendedPrice,
    adjustmentBps: adjustmentBps(result),
    priceChangeRequired:
      triggered &&
      result.blockedReasons.length === 0 &&
      result.recommendedPrice !== listing.effectiveSalePrice,
    blockedReasons: result.blockedReasons,
    reasons: result.reasons,
  };
}

function groupByGoodsKey(plans: ReceiptPriceListingPlan[]) {
  const grouped = new Map<string, ReceiptPriceListingPlan[]>();
  for (const plan of plans) {
    const rows = grouped.get(plan.goodsKey) ?? [];
    rows.push(plan);
    grouped.set(plan.goodsKey, rows);
  }
  return grouped;
}

function activeGoodsKeyOwners(products: PlanningProduct[]) {
  const owners = new Map<string, Set<string>>();
  for (const product of products) {
    if (product.skuActive === false) continue;
    const owner = barcodeKey(product.barcode);
    if (!owner) continue;
    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      const goodsKey = text(listing.goodsKey);
      if (!goodsKey) continue;
      const set = owners.get(goodsKey) ?? new Set<string>();
      set.add(owner);
      owners.set(goodsKey, set);
    }
  }
  return owners;
}

function affectedGoodsKeys(products: PlanningProduct[]) {
  const keys = new Set<string>();
  for (const product of products) {
    if (product.skuActive === false) continue;
    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      const goodsKey = text(listing.goodsKey);
      if (goodsKey) keys.add(goodsKey);
    }
  }
  return keys;
}

function goodsKeyPlans(
  plans: ReceiptPriceListingPlan[],
  ownersByGoodsKey: Map<string, Set<string>>,
  affectedBarcodes: Set<string>,
): ReceiptPriceGoodsKeyPlan[] {
  const byGoodsKey = groupByGoodsKey(plans);
  return [...byGoodsKey.entries()]
    .map(([goodsKey, rows]): ReceiptPriceGoodsKeyPlan => {
      const changed = rows.filter((row) => row.priceChangeRequired);
      const triggered = rows.filter((row) => row.receiptTriggered);
      const nonzeroBps = [...new Set(changed.map((row) => row.adjustmentBps))];
      const blockedRows = rows.filter((row) => row.blockedReasons.length > 0);
      const ownerBarcodes = [...(ownersByGoodsKey.get(goodsKey) ?? new Set())].sort();
      const plannedBarcodes = new Set(rows.map((row) => row.barcode));
      const unaffectedOwnerBarcodes = ownerBarcodes.filter(
        (barcode) => !affectedBarcodes.has(barcode),
      );
      const unplannedOwnerBarcodes = ownerBarcodes.filter(
        (barcode) => !plannedBarcodes.has(barcode),
      );
      let blockedReason: string | null = null;
      if (blockedRows.length) {
        blockedReason = "가격등급 입력 차단 행이 있습니다.";
      } else if (!ownerBarcodes.length) {
        blockedReason = "goods_key의 활성 B-code 소유자를 확인하지 못했습니다.";
      } else if (unaffectedOwnerBarcodes.length) {
        blockedReason = `같은 goods_key를 새 입고가 없는 B-code와 공유합니다: ${unaffectedOwnerBarcodes.join(", ")}`;
      } else if (unplannedOwnerBarcodes.length) {
        blockedReason = `같은 goods_key의 활성 소유자 중 가격계획이 없는 B-code가 있습니다: ${unplannedOwnerBarcodes.join(", ")}`;
      } else if (changed.length && triggered.length !== rows.length) {
        blockedReason =
          "같은 goods_key 안에 새 입고 트리거가 없는 옵션이 섞여 있습니다.";
      } else if (nonzeroBps.length > 1) {
        blockedReason =
          "같은 goods_key 안에서 필요한 가격 조정률이 서로 다릅니다.";
      }
      const automaticApplyEligible =
        changed.length > 0 &&
        triggered.length === rows.length &&
        nonzeroBps.length === 1 &&
        blockedRows.length === 0 &&
        ownerBarcodes.length > 0 &&
        unaffectedOwnerBarcodes.length === 0 &&
        unplannedOwnerBarcodes.length === 0 &&
        blockedReason === null;
      return {
        goodsKey,
        productGroup: rows.map((row) => row.productGroup).find(Boolean) ?? "",
        ptnGoodsCd: rows.map((row) => row.ptnGoodsCd).find(Boolean) ?? "",
        listingCount: rows.length,
        receiptTriggeredListingCount: triggered.length,
        priceChangeListingCount: changed.length,
        adjustmentBps: automaticApplyEligible ? nonzeroBps[0] : null,
        automaticApplyEligible,
        blockedReason,
        barcodes: [...new Set(rows.map((row) => row.barcode))].sort(),
        ownerBarcodes,
        unaffectedOwnerBarcodes,
        unplannedOwnerBarcodes,
      };
    })
    .sort((left, right) => Number(left.goodsKey) - Number(right.goodsKey));
}

function emptyReadiness(input: {
  generatedAt: string;
  inputCount: number;
  inputFingerprint: string;
}): ShoplingReceiptPriceReadiness {
  const stable = {
    inputFingerprint: input.inputFingerprint,
    affectedBarcodes: [] as string[],
    plans: [] as unknown[],
  };
  return {
    generatedAt: input.generatedAt,
    state: "READY",
    message:
      "기존 가격판정 이후 새 확정입고가 없습니다. 가격을 다시 결정할 상품이 없어 Shopling 조회와 가격 write를 모두 생략합니다.",
    currentPriceSource: "SHOPLING_LIVE_PRODUCT_LOOKUP",
    receiptCostSource: "PRODUCT_MASTER_WITH_RECEIPT_CACHE_FALLBACK",
    shoplingLookupMode: "RECEIPT_AFFECTED_ONLY",
    shoplingLookupSkipped: true,
    priceRuleVersion: PRICE_GRADE_RULE_VERSION,
    inputCount: input.inputCount,
    affectedInputCount: 0,
    affectedBarcodeCount: 0,
    affectedPlanningProductCount: 0,
    affectedPlanningMissingCount: 0,
    affectedGoodsKeyCount: 0,
    queriedGoodsKeyCount: 0,
    sourceRowCount: 0,
    livePriceReadyCount: 0,
    livePriceMissingCount: 0,
    livePriceConflictCount: 0,
    listingPlanCount: 0,
    receiptTriggeredListingCount: 0,
    priceChangeListingCount: 0,
    eligibleGoodsKeyCount: 0,
    blockedGoodsKeyCount: 0,
    fingerprint: fingerprint(stable),
    writesEnabled: false,
    listingPlans: [],
    goodsKeyPlans: [],
  };
}

export async function loadShoplingReceiptPriceReadiness(): Promise<ShoplingReceiptPriceReadiness> {
  const generatedAt = new Date().toISOString();
  const [augmented, planning] = await Promise.all([
    loadPriceGradeReceiptAugmentedSnapshot(),
    loadProductPlanningSnapshot(),
  ]);
  const allInputs = augmented.snapshot.inputs;
  const affectedInputs = allInputs.filter(receiptTriggeredInput);
  if (!affectedInputs.length) {
    return emptyReadiness({
      generatedAt,
      inputCount: augmented.snapshot.inputCount,
      inputFingerprint: augmented.snapshot.contentFingerprint,
    });
  }

  const affectedBarcodes = new Set(
    affectedInputs.map((input) => barcodeKey(input.barcode)).filter(Boolean),
  );
  const affectedPlanningProducts = planning.products.filter(
    (product) =>
      product.skuActive !== false && affectedBarcodes.has(barcodeKey(product.barcode)),
  );
  const planningBarcodes = new Set(
    affectedPlanningProducts.map((product) => barcodeKey(product.barcode)),
  );
  const affectedPlanningMissingCount = [...affectedBarcodes].filter(
    (barcode) => !planningBarcodes.has(barcode),
  ).length;
  const affectedGoodsKeySet = affectedGoodsKeys(affectedPlanningProducts);

  const live = await loadShoplingCurrentPriceSnapshot(affectedPlanningProducts);
  const liveByBarcode = new Map(live.rows.map((row) => [row.barcode, row]));
  const inputByBarcode = new Map(
    affectedInputs.map((input) => [barcodeKey(input.barcode), input]),
  );
  const listingPlans: ReceiptPriceListingPlan[] = [];

  for (const [barcode, input] of inputByBarcode) {
    const liveRow = liveByBarcode.get(barcode);
    if (!liveRow || liveRow.state !== "READY") continue;
    for (const listing of liveRow.listings) {
      listingPlans.push(listingPlan(input, listing, generatedAt));
    }
  }

  listingPlans.sort(
    (left, right) =>
      left.barcode.localeCompare(right.barcode) ||
      Number(left.goodsKey) - Number(right.goodsKey) ||
      left.optionId.localeCompare(right.optionId),
  );
  const grouped = goodsKeyPlans(
    listingPlans,
    activeGoodsKeyOwners(planning.products),
    affectedBarcodes,
  );
  const receiptTriggeredListingCount = listingPlans.filter(
    (row) => row.receiptTriggered,
  ).length;
  const priceChangeListingCount = listingPlans.filter(
    (row) => row.priceChangeRequired,
  ).length;
  const eligibleGoodsKeyCount = grouped.filter(
    (row) => row.automaticApplyEligible,
  ).length;
  const blockedGoodsKeyCount = grouped.filter(
    (row) => row.priceChangeListingCount > 0 && !row.automaticApplyEligible,
  ).length;
  const unresolvedAffectedCount =
    affectedPlanningMissingCount + live.missingCount + live.conflictCount;
  const state: ShoplingReceiptPriceReadiness["state"] =
    affectedPlanningMissingCount > 0 || live.readyCount === 0
      ? "BLOCKED"
      : unresolvedAffectedCount > 0 || blockedGoodsKeyCount > 0
        ? "PARTIAL"
        : "READY";
  const stable = {
    inputFingerprint: augmented.snapshot.contentFingerprint,
    affectedBarcodes: [...affectedBarcodes].sort(),
    affectedPlanningMissingCount,
    liveRows: live.rows.map((row) => ({
      barcode: row.barcode,
      state: row.state,
      listings: row.listings.map((listing) => ({
        goodsKey: listing.goodsKey,
        optionId: listing.optionId,
        effectiveSalePrice: listing.effectiveSalePrice,
      })),
    })),
    plans: listingPlans.map((row) => ({
      barcode: row.barcode,
      goodsKey: row.goodsKey,
      optionId: row.optionId,
      currentSalePrice: row.currentSalePrice,
      latestReceiptAt: row.latestReceiptAt,
      latestReceiptCostKrw: row.latestReceiptCostKrw,
      decision: row.decision,
      recommendedPrice: row.recommendedPrice,
      adjustmentBps: row.adjustmentBps,
      receiptTriggered: row.receiptTriggered,
    })),
    goodsKeyPlans: grouped.map((row) => ({
      goodsKey: row.goodsKey,
      ownerBarcodes: row.ownerBarcodes,
      adjustmentBps: row.adjustmentBps,
      automaticApplyEligible: row.automaticApplyEligible,
      blockedReason: row.blockedReason,
    })),
  };

  return {
    generatedAt,
    state,
    message:
      "새 확정입고가 감지된 B-code만 추려 해당 goods_key의 현재 Shopling 판매가를 즉시 다시 읽었습니다. 가격판정은 이 LIVE 판매가를 기준으로 기존 가격등급·최근 3회 보호원가 규칙을 적용합니다. 같은 goods_key를 입고 비대상 B-code와 공유하거나 조정률이 충돌하면 자동 적용 후보에서 제외합니다.",
    currentPriceSource: "SHOPLING_LIVE_PRODUCT_LOOKUP",
    receiptCostSource: "PRODUCT_MASTER_WITH_RECEIPT_CACHE_FALLBACK",
    shoplingLookupMode: "RECEIPT_AFFECTED_ONLY",
    shoplingLookupSkipped: false,
    priceRuleVersion: PRICE_GRADE_RULE_VERSION,
    inputCount: augmented.snapshot.inputCount,
    affectedInputCount: affectedInputs.length,
    affectedBarcodeCount: affectedBarcodes.size,
    affectedPlanningProductCount: affectedPlanningProducts.length,
    affectedPlanningMissingCount,
    affectedGoodsKeyCount: affectedGoodsKeySet.size,
    queriedGoodsKeyCount: live.queriedGoodsKeyCount,
    sourceRowCount: live.sourceRowCount,
    livePriceReadyCount: live.readyCount,
    livePriceMissingCount: live.missingCount,
    livePriceConflictCount: live.conflictCount,
    listingPlanCount: listingPlans.length,
    receiptTriggeredListingCount,
    priceChangeListingCount,
    eligibleGoodsKeyCount,
    blockedGoodsKeyCount,
    fingerprint: fingerprint(stable),
    writesEnabled: false,
    listingPlans,
    goodsKeyPlans: grouped,
  };
}
