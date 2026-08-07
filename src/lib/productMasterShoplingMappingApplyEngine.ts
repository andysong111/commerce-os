import type {
  ProductMasterShoplingDiagnosticReport,
  ProductMasterShoplingMappingCandidate,
} from "@/lib/productMasterShoplingDiagnosticEngine";
import type { PlanningProduct } from "@/lib/shopling/shoplingLiveAggregation";

export type ProductMasterShoplingMappingBlockerCode =
  | "DIAGNOSTIC_BLOCKED"
  | "INVALID_CANDIDATE"
  | "OPTION_ID_REQUIRED"
  | "SKU_NOT_FOUND"
  | "SKU_INACTIVE"
  | "BARCODE_CHANGED"
  | "SHOPLING_IDENTITY_CONFLICT"
  | "UNITS_PER_ORDER_CONFLICT"
  | "DUPLICATE_CANDIDATE_IDENTITY";

export type ProductMasterShoplingMappingBlocker = {
  code: ProductMasterShoplingMappingBlockerCode;
  skuId: string | null;
  barcode: string;
  goodsKey: string;
  optionId: string;
  message: string;
};

export type ProductMasterShoplingMappingApplyRow = {
  id: string;
  barcode: string;
  skuId: string;
  goodsKey: string;
  optionId: string;
  channel: "Shopling";
  listingName: string;
  listingOptionName: string;
  unitsPerOrder: number;
  active: true;
};

export type ProductMasterShoplingMappingApplyPlan = {
  generatedAt: string;
  diagnosticGeneratedAt: string;
  totalCandidates: number;
  safeCandidateCount: number;
  pendingCount: number;
  alreadyAppliedCount: number;
  blockerCount: number;
  readyForCanary: boolean;
  pending: ProductMasterShoplingMappingApplyRow[];
  alreadyApplied: ProductMasterShoplingMappingApplyRow[];
  blockers: ProductMasterShoplingMappingBlocker[];
};

type CurrentListing = {
  skuId: string;
  barcode: string;
  unitsPerOrder: number;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function safeUnits(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function identity(goodsKey: unknown, optionId: unknown) {
  const goods = text(goodsKey);
  const option = text(optionId);
  return goods && option ? `${goods}\u0000${option}` : "";
}

function stableId(candidate: ProductMasterShoplingMappingCandidate) {
  return [
    "shopling-auto",
    encodeURIComponent(text(candidate.goodsKey)),
    encodeURIComponent(text(candidate.optionId)),
    encodeURIComponent(barcode(candidate.barcode)),
  ].join(":");
}

function rowFromCandidate(
  candidate: ProductMasterShoplingMappingCandidate,
  unitsPerOrder: number,
): ProductMasterShoplingMappingApplyRow {
  return {
    id: stableId(candidate),
    barcode: barcode(candidate.barcode),
    skuId: text(candidate.skuId),
    goodsKey: text(candidate.goodsKey),
    optionId: text(candidate.optionId),
    channel: "Shopling",
    listingName: text(candidate.productName),
    listingOptionName: text(candidate.optionName) || "단품",
    unitsPerOrder,
    active: true,
  };
}

function blocker(
  candidate: Partial<ProductMasterShoplingMappingCandidate>,
  code: ProductMasterShoplingMappingBlockerCode,
  message: string,
): ProductMasterShoplingMappingBlocker {
  return {
    code,
    skuId: text(candidate.skuId) || null,
    barcode: barcode(candidate.barcode),
    goodsKey: text(candidate.goodsKey),
    optionId: text(candidate.optionId),
    message,
  };
}

export function buildProductMasterShoplingMappingApplyPlan(
  report: ProductMasterShoplingDiagnosticReport,
  planningProducts: PlanningProduct[],
  generatedAt = new Date().toISOString(),
): ProductMasterShoplingMappingApplyPlan {
  const blockers: ProductMasterShoplingMappingBlocker[] = [];
  const pending: ProductMasterShoplingMappingApplyRow[] = [];
  const alreadyApplied: ProductMasterShoplingMappingApplyRow[] = [];

  if (report.summary.blockerCount > 0 || !report.summary.readyForMappingReview) {
    blockers.push({
      code: "DIAGNOSTIC_BLOCKED",
      skuId: null,
      barcode: "",
      goodsKey: "",
      optionId: "",
      message: `전수진단 차단 문제가 ${report.summary.blockerCount}건 남아 있어 자동 연결을 적용하지 않습니다.`,
    });
  }

  const skuById = new Map<string, PlanningProduct>();
  const currentByIdentity = new Map<string, CurrentListing[]>();
  for (const product of planningProducts) {
    const skuId = text(product.skuId);
    if (skuId) skuById.set(skuId, product);
    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      const key = identity(listing.goodsKey, listing.optionId);
      if (!key) continue;
      const unitsPerOrder = safeUnits(listing.unitsPerOrder);
      currentByIdentity.set(key, [
        ...(currentByIdentity.get(key) ?? []),
        {
          skuId,
          barcode: barcode(product.barcode),
          unitsPerOrder: unitsPerOrder ?? 0,
        },
      ]);
    }
  }

  const candidateIdentities = new Map<string, string>();
  for (const candidate of report.candidates) {
    const goodsKey = text(candidate.goodsKey);
    const optionId = text(candidate.optionId);
    const candidateSkuId = text(candidate.skuId);
    const candidateBarcode = barcode(candidate.barcode);
    const unitsPerOrder = safeUnits(candidate.expectedUnitsPerOrder);
    const key = identity(goodsKey, optionId);

    if (
      !candidateSkuId ||
      !candidateBarcode ||
      !goodsKey ||
      !unitsPerOrder ||
      candidate.inference === "AMBIGUOUS"
    ) {
      blockers.push(
        blocker(
          candidate,
          "INVALID_CANDIDATE",
          "자동 연결 후보의 SKU·위치코드·goods_key·환산수량 중 하나가 확정되지 않아 적용하지 않습니다.",
        ),
      );
      continue;
    }
    if (!optionId) {
      blockers.push(
        blocker(
          candidate,
          "OPTION_ID_REQUIRED",
          "Shopling 옵션 ID가 없는 후보는 동일 옵션 여부를 안전하게 재검증할 수 없어 자동 적용하지 않습니다.",
        ),
      );
      continue;
    }

    const priorOwner = candidateIdentities.get(key);
    if (priorOwner && priorOwner !== candidateSkuId) {
      blockers.push(
        blocker(
          candidate,
          "DUPLICATE_CANDIDATE_IDENTITY",
          "같은 Shopling goods_key·옵션 ID가 서로 다른 상품마스터 SKU 후보에 포함되어 자동 적용을 차단했습니다.",
        ),
      );
      continue;
    }
    candidateIdentities.set(key, candidateSkuId);

    const sku = skuById.get(candidateSkuId);
    if (!sku) {
      blockers.push(
        blocker(
          candidate,
          "SKU_NOT_FOUND",
          "전수진단 이후 상품마스터 SKU를 찾을 수 없어 자동 적용을 차단했습니다.",
        ),
      );
      continue;
    }
    if (sku.skuActive === false) {
      blockers.push(
        blocker(
          candidate,
          "SKU_INACTIVE",
          "전수진단 이후 상품마스터 SKU가 비활성화되어 자동 적용을 차단했습니다.",
        ),
      );
      continue;
    }
    if (barcode(sku.barcode) !== candidateBarcode) {
      blockers.push(
        blocker(
          candidate,
          "BARCODE_CHANGED",
          `전수진단 이후 위치코드가 ${candidateBarcode}에서 ${barcode(sku.barcode)}로 변경되어 자동 적용을 차단했습니다.`,
        ),
      );
      continue;
    }

    const current = currentByIdentity.get(key) ?? [];
    const differentOwner = current.find((listing) => listing.skuId !== candidateSkuId);
    if (differentOwner) {
      blockers.push(
        blocker(
          candidate,
          "SHOPLING_IDENTITY_CONFLICT",
          `같은 Shopling goods_key·옵션 ID가 현재 다른 SKU(${differentOwner.barcode})에 연결되어 자동 적용을 차단했습니다.`,
        ),
      );
      continue;
    }
    const sameOwner = current.find((listing) => listing.skuId === candidateSkuId);
    const row = rowFromCandidate(candidate, unitsPerOrder);
    if (sameOwner) {
      if (sameOwner.unitsPerOrder !== unitsPerOrder) {
        blockers.push(
          blocker(
            candidate,
            "UNITS_PER_ORDER_CONFLICT",
            `같은 Shopling 옵션의 현재 환산수량 ${sameOwner.unitsPerOrder}개와 권장 ${unitsPerOrder}개가 달라 자동 적용을 차단했습니다.`,
          ),
        );
      } else {
        alreadyApplied.push(row);
      }
      continue;
    }
    pending.push(row);
  }

  const safeCandidateCount = pending.length + alreadyApplied.length;
  return {
    generatedAt,
    diagnosticGeneratedAt: report.generatedAt,
    totalCandidates: report.candidates.length,
    safeCandidateCount,
    pendingCount: pending.length,
    alreadyAppliedCount: alreadyApplied.length,
    blockerCount: blockers.length,
    readyForCanary: blockers.length === 0 && pending.length > 0,
    pending,
    alreadyApplied,
    blockers,
  };
}
