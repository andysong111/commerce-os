import { createHash } from "node:crypto";
import { calculateNetRequirement } from "@/lib/productDecisionEngine/netRequirement";
import type { SalesOrderGroup } from "@/lib/productDecisionEngine/salesOrder";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadProductLaunchPurchaseMetadataByBarcode } from "@/lib/productLaunchPurchaseMetadata";
import { loadShoplingCurrentModelSnapshot } from "@/lib/shopling/shoplingCurrentModelIdentity";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import { loadProvisionalInventoryDiagnostics } from "@/lib/stage8ProvisionalInventoryDiagnostics";

export type FastPurchaseMvpAction =
  | "ORDER_REVIEW"
  | "HOLD"
  | "FALLBACK_ORDER_REVIEW"
  | "FALLBACK_HOLD"
  | "MANUAL_REVIEW"
  | "DEMAND_ONLY_REVIEW"
  | "DATA_HOLD";

export type FastPurchaseMvpBasis =
  | "TWO_SIDED_BAND"
  | "CUMULATIVE_UPPER_BIASED"
  | "DEMAND_ONLY_ZERO_STOCK_REFERENCE"
  | "INSUFFICIENT";

export type FastPurchaseMvpRow = {
  barcode: string;
  modelNo: string | null;
  modelName?: string | null;
  optionName?: string | null;
  productName: string;
  action: FastPurchaseMvpAction;
  actionLabel: string;
  basis: FastPurchaseMvpBasis;
  riskBias:
    | "BALANCED_BAND"
    | "UNDER_ORDER_BIASED"
    | "OVER_ORDER_IF_MISUSED"
    | "UNKNOWN";
  recommendedQuantity: number;
  referenceDemandQuantity: number;
  planningInventoryQuantity: number | null;
  inventoryBandLow: number | null;
  inventoryBandHigh: number | null;
  lowScenarioRecommendedQuantity: number | null;
  highScenarioRecommendedQuantity: number | null;
  reason: string;
  usableForTodayDecision: boolean;
  manualTriageReady: boolean;
  manualOrderOnly: true;
  automaticPurchaseEnabled: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

export type FastPurchaseMvpReport = {
  generatedAt: string;
  state: "READY_MVP" | "BLOCKED";
  message: string;
  evaluatedCount: number;
  systemDecisionCount: number;
  manualTriageCount: number;
  operationalCoverageCount: number;
  orderReviewCount: number;
  holdCount: number;
  fallbackDecisionCount: number;
  manualReviewCount: number;
  demandOnlyReviewCount: number;
  dataHoldCount: number;
  usableDecisionCount: number;
  fingerprint: string;
  mode: "FAST_USE_PROVISIONAL_V2_1";
  manualOrderOnly: true;
  automaticPurchaseEnabled: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: FastPurchaseMvpRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function salesOrderGroup(value: unknown): SalesOrderGroup {
  const normalized = text(value);
  if (
    normalized === "발주 추천" ||
    normalized === "소량 검토" ||
    normalized === "발주 보류" ||
    normalized === "데이터 부족"
  ) {
    return normalized;
  }
  return "발주 보류";
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function actionPriority(action: FastPurchaseMvpAction) {
  if (action === "ORDER_REVIEW") return 0;
  if (action === "FALLBACK_ORDER_REVIEW") return 1;
  if (action === "MANUAL_REVIEW") return 2;
  if (action === "DEMAND_ONLY_REVIEW") return 3;
  if (action === "HOLD") return 4;
  if (action === "FALLBACK_HOLD") return 5;
  return 6;
}

function baseCommon(input: {
  barcode: string;
  modelNo: string | null;
  modelName: string | null;
  optionName: string | null;
  productName: string;
  inventoryBandLow?: number | null;
  inventoryBandHigh?: number | null;
  lowScenarioRecommendedQuantity?: number | null;
  highScenarioRecommendedQuantity?: number | null;
}) {
  return {
    barcode: input.barcode,
    modelNo: input.modelNo,
    modelName: input.modelName,
    optionName: input.optionName,
    productName: input.productName,
    referenceDemandQuantity: 0,
    planningInventoryQuantity: null,
    inventoryBandLow: input.inventoryBandLow ?? null,
    inventoryBandHigh: input.inventoryBandHigh ?? null,
    lowScenarioRecommendedQuantity:
      input.lowScenarioRecommendedQuantity ?? null,
    highScenarioRecommendedQuantity:
      input.highScenarioRecommendedQuantity ?? null,
    manualTriageReady: false,
    manualOrderOnly: true as const,
    automaticPurchaseEnabled: false as const,
    purchaseWritesEnabled: false as const,
    inventoryWritesEnabled: false as const,
  };
}

export async function loadFastPurchaseMvp(): Promise<FastPurchaseMvpReport> {
  const [diagnostics, purchaseShadow, planning, trackerMetadata] = await Promise.all([
    loadProvisionalInventoryDiagnostics(),
    loadCanonicalPurchaseShadow(),
    loadProductPlanningSnapshot(),
    loadProductLaunchPurchaseMetadataByBarcode(),
  ]);
  const purchaseProducts = purchaseShadow.snapshot?.products ?? [];
  const purchaseByBarcode = new Map(
    purchaseProducts.map((row) => [barcode(row.barcode), row] as const),
  );
  const planningByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const),
  );

  const candidateBarcodes = new Set(
    [
      ...diagnostics.rows.map((row) => barcode(row.barcode)),
      ...purchaseProducts
        .filter(
          (purchase) =>
            (purchase.status === "발주 추천" || purchase.status === "소량 검토") &&
            integer(purchase.recommendedQty) > 0,
        )
        .map((purchase) => barcode(purchase.barcode)),
    ].filter(Boolean),
  );
  const goodsKeysByBarcode = new Map<string, string[]>();
  for (const key of candidateBarcodes) {
    const profile = planningByBarcode.get(key);
    const goodsKeys = [
      ...new Set(
        (profile?.listings ?? [])
          .filter((listing) => listing.active !== false)
          .map((listing) => text(listing.goodsKey))
          .filter((goodsKey) => /^\d+$/.test(goodsKey)),
      ),
    ].sort((left, right) => Number(left) - Number(right));
    goodsKeysByBarcode.set(key, goodsKeys);
  }

  const liveShoplingByBarcode = new Map<
    string,
    { modelNo: string | null; modelName: string | null }
  >();
  try {
    const goodsKeys = [
      ...new Set([...goodsKeysByBarcode.values()].flat()),
    ].sort((left, right) => Number(left) - Number(right));
    if (goodsKeys.length) {
      const live = await loadShoplingCurrentModelSnapshot(goodsKeys);
      const liveByGoodsKey = new Map(
        live.rows.map((row) => [row.goodsKey, row] as const),
      );
      for (const [key, barcodeGoodsKeys] of goodsKeysByBarcode) {
        const sourceRows = barcodeGoodsKeys
          .map((goodsKey) => liveByGoodsKey.get(goodsKey))
          .filter((row): row is NonNullable<typeof row> => Boolean(row));
        const exactModelNos = [
          ...new Set(
            sourceRows
              .filter((row) => row.state === "EXACT_AAA")
              .flatMap((row) => row.modelNos.map(text).filter(Boolean)),
          ),
        ].sort();
        const modelNames = [
          ...new Set(
            sourceRows.flatMap((row) => row.modelNames.map(text).filter(Boolean)),
          ),
        ].sort((left, right) => left.localeCompare(right, "ko"));
        liveShoplingByBarcode.set(key, {
          modelNo: exactModelNos.length === 1 ? exactModelNos[0] : null,
          modelName: modelNames.length ? modelNames.join(" / ") : null,
        });
      }
    }
  } catch {
    // Display-only Shopling identity lookup must never block the purchase workspace.
  }

  const diagnosticRows = diagnostics.rows.map((row): FastPurchaseMvpRow => {
    const key = barcode(row.barcode);
    const tracker = trackerMetadata.byBarcode.get(key);
    const profile = planningByBarcode.get(key);
    const liveShopling = liveShoplingByBarcode.get(key);
    const common = baseCommon({
      barcode: key,
      modelNo: liveShopling?.modelNo || tracker?.modelNumber || row.modelNo,
      modelName: liveShopling?.modelName || null,
      optionName: tracker?.saleOption || text(profile?.optionName) || null,
      productName: row.productName,
      inventoryBandLow: row.diagnosticLowQuantity,
      inventoryBandHigh: row.diagnosticHighQuantity,
      lowScenarioRecommendedQuantity: row.lowRecommendedQuantity,
      highScenarioRecommendedQuantity: row.highRecommendedQuantity,
    });

    if (
      row.state === "BAND_READY" &&
      row.decisionState === "ORDER_DIRECTION_STABLE" &&
      row.conservativeDraftRecommendedQuantity > 0
    ) {
      return {
        ...common,
        action: "ORDER_REVIEW",
        actionLabel: "발주 검토",
        basis: "TWO_SIDED_BAND",
        riskBias: "BALANCED_BAND",
        recommendedQuantity: row.conservativeDraftRecommendedQuantity,
        reason:
          "추정재고의 낮은값과 높은값 양쪽 모두 발주가 필요합니다. 두 시나리오 권장수량 중 더 작은 수량만 사용합니다.",
        usableForTodayDecision: true,
      };
    }

    if (
      row.state === "BAND_READY" &&
      row.decisionState === "HOLD_DIRECTION_STABLE"
    ) {
      return {
        ...common,
        action: "HOLD",
        actionLabel: "발주 보류",
        basis: "TWO_SIDED_BAND",
        riskBias: "BALANCED_BAND",
        recommendedQuantity: 0,
        reason:
          "추정재고의 낮은값과 높은값 양쪽 모두에서 신규 발주가 필요하지 않아 오늘은 보류합니다.",
        usableForTodayDecision: true,
      };
    }

    if (
      row.state === "BAND_READY" &&
      row.decisionState === "INVENTORY_SENSITIVE"
    ) {
      return {
        ...common,
        action: "MANUAL_REVIEW",
        actionLabel: "수동 검토",
        basis: "TWO_SIDED_BAND",
        riskBias: "BALANCED_BAND",
        recommendedQuantity: 0,
        reason:
          "추정재고가 낮은 쪽인지 높은 쪽인지에 따라 발주/보류가 뒤집힙니다. 이 상품만 사람이 한 번 확인합니다.",
        usableForTodayDecision: false,
        manualTriageReady: true,
      };
    }

    const purchase = purchaseByBarcode.get(key);
    const fallbackInventory = row.cumulativeResidualCandidate;
    const fallbackEligible =
      row.state !== "IDENTITY_BLOCKED" &&
      fallbackInventory !== null &&
      purchase &&
      profile;

    if (fallbackEligible) {
      const fallback = calculateNetRequirement({
        demandTarget: integer(
          purchase.rawRecommendedQty ?? purchase.recommendedQty,
        ),
        originalGroup: salesOrderGroup(purchase.status),
        inventoryKnown: true,
        availableQuantity: fallbackInventory,
        reservedQuantity: 0,
        incomingQuantity: 0,
        ledgerCommitment: integer(purchase.openCommitment),
        moq: Math.max(1, integer(profile.moq) || 1),
        cartonQuantity: Math.max(1, integer(profile.cartonQuantity) || 1),
      });
      const orders = fallback.recommendedQuantity > 0;
      return {
        ...common,
        action: orders ? "FALLBACK_ORDER_REVIEW" : "FALLBACK_HOLD",
        actionLabel: orders ? "보수적 발주 검토" : "보수적 발주 보류",
        basis: "CUMULATIVE_UPPER_BIASED",
        riskBias: "UNDER_ORDER_BIASED",
        recommendedQuantity: fallback.recommendedQuantity,
        referenceDemandQuantity: integer(purchase.recommendedQty),
        planningInventoryQuantity: fallbackInventory,
        reason: orders
          ? "완전한 최신 입고증거를 기다리지 않고 과거 누적발주에서 최근 360일 exact 판매를 뺀 상한편향 추정재고를 임시 사용했습니다. 실제재고를 높게 잡을 수 있으므로 과잉발주보다 발주가 늦어질 위험을 받아들이는 절충안입니다."
          : "상한편향 추정재고를 적용하면 현재 수요목표와 미입고 수량을 감안해 추가 발주가 필요하지 않습니다. 실제보다 재고를 높게 잡았을 가능성이 있으므로 품절 발생 시 0-reset으로 빠르게 교정합니다.",
        usableForTodayDecision: true,
      };
    }

    return {
      ...common,
      action: "DATA_HOLD",
      actionLabel: "데이터 보류",
      basis: "INSUFFICIENT",
      riskBias: "UNKNOWN",
      recommendedQuantity: 0,
      reason:
        "현재 증거로는 추정재고 밴드도 상한편향 대체값도 만들 수 없습니다. 아래 수요전용 후보에 포함되지 않는 상품은 이번 빠른 운영 범위에서 제외합니다.",
      usableForTodayDecision: false,
    };
  });

  const diagnosticBarcodes = new Set(
    diagnosticRows.map((row) => barcode(row.barcode)),
  );
  const demandOnlyRows: FastPurchaseMvpRow[] = purchaseProducts
    .filter((purchase) => {
      const key = barcode(purchase.barcode);
      const candidateGroup =
        purchase.status === "발주 추천" || purchase.status === "소량 검토";
      return (
        key &&
        !diagnosticBarcodes.has(key) &&
        candidateGroup &&
        integer(purchase.recommendedQty) > 0
      );
    })
    .map((purchase) => {
      const key = barcode(purchase.barcode);
      const tracker = trackerMetadata.byBarcode.get(key);
      const profile = planningByBarcode.get(key);
      const liveShopling = liveShoplingByBarcode.get(key);
      const fallbackProductName = text(purchase.name) || key;
      return {
        ...baseCommon({
          barcode: key,
          modelNo:
            liveShopling?.modelNo || tracker?.modelNumber || text(purchase.modelNo) || null,
          modelName: liveShopling?.modelName || null,
          optionName: tracker?.saleOption || text(profile?.optionName) || null,
          productName: fallbackProductName,
        }),
        action: "DEMAND_ONLY_REVIEW" as const,
        actionLabel: "수요만 수동검토",
        basis: "DEMAND_ONLY_ZERO_STOCK_REFERENCE" as const,
        riskBias: "OVER_ORDER_IF_MISUSED" as const,
        recommendedQuantity: 0,
        referenceDemandQuantity: integer(purchase.recommendedQty),
        reason:
          "판매수요와 중국 미입고 약정까지 반영한 기존 발주안은 양수이지만 현재 재고 증거가 없습니다. 표시된 수량은 재고 0 가정의 참고상한일 뿐 실제 주문수량이 아닙니다. 사용자가 상품을 보고 재고가 충분하다고 기억하면 보류하고, 부족하다고 판단할 때만 수동으로 수량을 정합니다.",
        usableForTodayDecision: false,
        manualTriageReady: true,
      };
    });

  const rows = [...diagnosticRows, ...demandOnlyRows].sort(
    (left, right) =>
      actionPriority(left.action) - actionPriority(right.action) ||
      right.recommendedQuantity - left.recommendedQuantity ||
      right.referenceDemandQuantity - left.referenceDemandQuantity ||
      left.barcode.localeCompare(right.barcode),
  );

  const stable = rows.map((row) => ({
    barcode: row.barcode,
    action: row.action,
    basis: row.basis,
    recommendedQuantity: row.recommendedQuantity,
    referenceDemandQuantity: row.referenceDemandQuantity,
    planningInventoryQuantity: row.planningInventoryQuantity,
    inventoryBandLow: row.inventoryBandLow,
    inventoryBandHigh: row.inventoryBandHigh,
    lowScenarioRecommendedQuantity: row.lowScenarioRecommendedQuantity,
    highScenarioRecommendedQuantity: row.highScenarioRecommendedQuantity,
  }));
  const ready =
    diagnostics.state === "READY_READ_ONLY" &&
    Boolean(purchaseShadow.snapshot) &&
    planning.products.length > 0;
  const systemDecisionCount = rows.filter(
    (row) => row.usableForTodayDecision,
  ).length;
  const manualTriageCount = rows.filter((row) => row.manualTriageReady).length;

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_MVP" : "BLOCKED",
    message: ready
      ? "빠른 사용 우선 모드입니다. 재고증거가 있는 상품은 시스템이 보수적으로 발주/보류를 판단하고, 재고증거가 없는 기존 발주후보도 숨기지 않고 재고 0 가정 참고수량과 함께 수동 판단목록으로 보여줍니다. 참고수량을 실제 주문수량으로 자동 사용하지 않습니다."
      : "발주 수요 또는 PROVISIONAL 추정재고 입력이 준비되지 않아 빠른 운영 발주안을 만들지 않습니다.",
    evaluatedCount: rows.length,
    systemDecisionCount,
    manualTriageCount,
    operationalCoverageCount: new Set([
      ...rows
        .filter((row) => row.usableForTodayDecision || row.manualTriageReady)
        .map((row) => row.barcode),
    ]).size,
    orderReviewCount: rows.filter(
      (row) =>
        row.action === "ORDER_REVIEW" ||
        row.action === "FALLBACK_ORDER_REVIEW",
    ).length,
    holdCount: rows.filter(
      (row) => row.action === "HOLD" || row.action === "FALLBACK_HOLD",
    ).length,
    fallbackDecisionCount: rows.filter(
      (row) => row.basis === "CUMULATIVE_UPPER_BIASED",
    ).length,
    manualReviewCount: rows.filter(
      (row) => row.action === "MANUAL_REVIEW",
    ).length,
    demandOnlyReviewCount: rows.filter(
      (row) => row.action === "DEMAND_ONLY_REVIEW",
    ).length,
    dataHoldCount: rows.filter((row) => row.action === "DATA_HOLD").length,
    usableDecisionCount: systemDecisionCount,
    fingerprint: sha256({
      diagnosticsFingerprint: diagnostics.fingerprint,
      purchaseFingerprint: purchaseShadow.canonicalContentFingerprint,
      planningFingerprint: planning.contentFingerprint,
      rows: stable,
    }),
    mode: "FAST_USE_PROVISIONAL_V2_1",
    manualOrderOnly: true,
    automaticPurchaseEnabled: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}
