import { createHash } from "node:crypto";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadPurchaseCandidateLegacyModelRecovery } from "@/lib/stage8PurchaseCandidateLegacyModelRecovery";

export type PurchaseCandidateShoplingListingIdentity = {
  goodsKey: string;
  optionId: string | null;
  unitsPerOrder: number;
  active: boolean;
};

export type PurchaseCandidateShoplingIdentityAuditRow = {
  barcode: string;
  productName: string;
  currentModelNo: string | null;
  recoveredExactModelNo: string | null;
  recoveryState: string;
  recommendedQty: number;
  listings: PurchaseCandidateShoplingListingIdentity[];
  goodsKeys: string[];
  optionIds: string[];
  activeGoodsKeyCount: number;
  activeOptionIdCount: number;
  state: "IDENTITY_SET_READY" | "NO_ACTIVE_LISTING";
  historicalModelJoinAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  shoplingWritesEnabled: false;
};

export type PurchaseCandidateShoplingIdentityAudit = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  message: string;
  purchaseCandidateCount: number;
  identitySetReadyCount: number;
  noActiveListingCount: number;
  multiGoodsKeyCount: number;
  uniqueGoodsKeyCount: number;
  fingerprint: string;
  historicalModelJoinAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  shoplingWritesEnabled: false;
  rows: PurchaseCandidateShoplingIdentityAuditRow[];
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

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadPurchaseCandidateShoplingIdentityAudit(): Promise<PurchaseCandidateShoplingIdentityAudit> {
  const [recovery, planning] = await Promise.all([
    loadPurchaseCandidateLegacyModelRecovery(),
    loadProductPlanningSnapshot(),
  ]);

  const planningByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const),
  );

  const rows = recovery.rows
    .map((candidate): PurchaseCandidateShoplingIdentityAuditRow => {
      const key = barcode(candidate.barcode);
      const plan = planningByBarcode.get(key);
      const listings = (plan?.listings ?? [])
        .map((listing): PurchaseCandidateShoplingListingIdentity => ({
          goodsKey: text(listing.goodsKey),
          optionId: text(listing.optionId) || null,
          unitsPerOrder: Math.max(1, integer(listing.unitsPerOrder) || 1),
          active: listing.active !== false,
        }))
        .filter((listing) => listing.goodsKey)
        .sort(
          (left, right) =>
            left.goodsKey.localeCompare(right.goodsKey) ||
            String(left.optionId ?? "").localeCompare(String(right.optionId ?? "")),
        );
      const activeListings = listings.filter((listing) => listing.active);
      const goodsKeys = [...new Set(activeListings.map((listing) => listing.goodsKey))].sort();
      const optionIds = [
        ...new Set(
          activeListings
            .map((listing) => listing.optionId)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort();
      const state = goodsKeys.length > 0 ? "IDENTITY_SET_READY" : "NO_ACTIVE_LISTING";

      return {
        barcode: key,
        productName: candidate.productName,
        currentModelNo: candidate.currentModelNo,
        recoveredExactModelNo: candidate.effectiveModelNo,
        recoveryState: candidate.state,
        recommendedQty: candidate.recommendedQty,
        listings,
        goodsKeys,
        optionIds,
        activeGoodsKeyCount: goodsKeys.length,
        activeOptionIdCount: optionIds.length,
        state,
        historicalModelJoinAllowed: false,
        inventoryPromotionAllowed: false,
        purchaseWritesEnabled: false,
        inventoryWritesEnabled: false,
        shoplingWritesEnabled: false,
      };
    })
    .sort(
      (left, right) =>
        Number(left.state !== "IDENTITY_SET_READY") -
          Number(right.state !== "IDENTITY_SET_READY") ||
        left.barcode.localeCompare(right.barcode),
    );

  const ready = recovery.state === "READY_READ_ONLY" && rows.length > 0;
  const uniqueGoodsKeys = new Set(rows.flatMap((row) => row.goodsKeys));
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    currentModelNo: row.currentModelNo,
    recoveredExactModelNo: row.recoveredExactModelNo,
    recoveryState: row.recoveryState,
    recommendedQty: row.recommendedQty,
    goodsKeys: row.goodsKeys,
    optionIds: row.optionIds,
    listings: row.listings,
    state: row.state,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_READ_ONLY" : "BLOCKED",
    message: ready
      ? "현재 발주후보의 B-code를 Product Master planning의 활성 Shopling goods_key/optionId 전체 집합과 읽기 전용으로 연결합니다. 하나의 B-code가 여러 상품그룹·판매 listing을 가져 goods_key가 여러 개인 것은 정상 범위이며, 이 전체 집합을 과거 Shopling 가격·모델 자료와 교차검증합니다. goods_key만으로 aaa 모델번호를 추정하거나 재고·발주를 실행하지 않습니다."
      : "현재 발주후보 모델복구 증거 또는 planning 스냅샷이 준비되지 않아 Shopling 식별자 교차검증을 차단합니다.",
    purchaseCandidateCount: rows.length,
    identitySetReadyCount: rows.filter((row) => row.state === "IDENTITY_SET_READY").length,
    noActiveListingCount: rows.filter((row) => row.state === "NO_ACTIVE_LISTING").length,
    multiGoodsKeyCount: rows.filter((row) => row.goodsKeys.length > 1).length,
    uniqueGoodsKeyCount: uniqueGoodsKeys.size,
    fingerprint: sha256({
      recoveryFingerprint: recovery.fingerprint,
      planningFingerprint: planning.contentFingerprint,
      rows: stable,
    }),
    historicalModelJoinAllowed: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    shoplingWritesEnabled: false,
    rows,
  };
}
