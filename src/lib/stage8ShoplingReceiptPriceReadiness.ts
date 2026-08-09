import { createHash } from "node:crypto";
import {
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
};

export type ShoplingReceiptPriceReadiness = {
  generatedAt: string;
  state: "READY" | "PARTIAL" | "BLOCKED";
  message: string;
  currentPriceSource: "SHOPLING_LIVE_PRODUCT_LOOKUP";
  receiptCostSource: "PRODUCT_MASTER_WITH_RECEIPT_CACHE_FALLBACK";
  priceRuleVersion: string;
  inputCount: number;
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

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
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

function adjustmentBps(result: ProductPriceGradeResult) {
  return Math.round(result.adjustmentRate * 10_000);
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function listingPlan(
  input: Awaited<
    ReturnType<typeof loadPriceGradeReceiptAugmentedSnapshot>
  >["snapshot"]["inputs"][number],
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
    barcode: text(input.barcode).toUpperCase(),
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

function goodsKeyPlans(
  plans: ReceiptPriceListingPlan[],
): ReceiptPriceGoodsKeyPlan[] {
  const byGoodsKey = groupByGoodsKey(plans);
  return [...byGoodsKey.entries()]
    .map(([goodsKey, rows]): ReceiptPriceGoodsKeyPlan => {
      const changed = rows.filter((row) => row.priceChangeRequired);
      const triggered = rows.filter((row) => row.receiptTriggered);
      const nonzeroBps = [...new Set(changed.map((row) => row.adjustmentBps))];
      const blockedRows = rows.filter((row) => row.blockedReasons.length > 0);
      let blockedReason: string | null = null;
      if (blockedRows.length) {
        blockedReason = "가격등급 입력 차단 행이 있습니다.";
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
      };
    })
    .sort((left, right) => Number(left.goodsKey) - Number(right.goodsKey));
}

export async function loadShoplingReceiptPriceReadiness(): Promise<ShoplingReceiptPriceReadiness> {
  const generatedAt = new Date().toISOString();
  const [augmented, planning] = await Promise.all([
    loadPriceGradeReceiptAugmentedSnapshot(),
    loadProductPlanningSnapshot(),
  ]);
  const live = await loadShoplingCurrentPriceSnapshot(planning.products);
  const liveByBarcode = new Map(live.rows.map((row) => [row.barcode, row]));
  const listingPlans: ReceiptPriceListingPlan[] = [];

  for (const input of augmented.snapshot.inputs) {
    const barcode = text(input.barcode).toUpperCase().replace(/\s+/g, "");
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
  const grouped = goodsKeyPlans(listingPlans);
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
  const state =
    live.readyCount === live.productCount && blockedGoodsKeyCount === 0
      ? "READY"
      : live.readyCount > 0
        ? "PARTIAL"
        : "BLOCKED";
  const stable = {
    inputFingerprint: augmented.snapshot.contentFingerprint,
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
  };

  return {
    generatedAt,
    state,
    message:
      "현재 판매가는 매 실행마다 Shopling 상품조회 prod_id로 다시 읽습니다. 새 확정입고가 기존 가격판정 이후 들어온 옵션만 재가격 트리거로 잡고, 기존 가격등급·최근 3회 보호원가 규칙으로 목표가격을 다시 계산합니다. 같은 goods_key 안에서 조정률이 충돌하면 자동 적용 후보에서 제외합니다.",
    currentPriceSource: "SHOPLING_LIVE_PRODUCT_LOOKUP",
    receiptCostSource: "PRODUCT_MASTER_WITH_RECEIPT_CACHE_FALLBACK",
    priceRuleVersion: "commerce-os-price-grade-v1.0.0",
    inputCount: augmented.snapshot.inputCount,
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
