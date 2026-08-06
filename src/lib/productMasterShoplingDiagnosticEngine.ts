import { normalizeShoplingBarcode } from "@/lib/shopling/shoplingNormalize";

export type DiagnosticPlanningListing = {
  goodsKey?: string | null;
  optionId?: string | null;
  unitsPerOrder?: number;
  active?: boolean;
};

export type DiagnosticPlanningSku = {
  skuId: string;
  modelNo?: string | null;
  barcode: string;
  productName: string;
  optionName?: string | null;
  skuActive?: boolean;
  listings?: DiagnosticPlanningListing[];
};

export type DiagnosticShoplingOption = {
  goodsKey: string;
  optionId: string;
  barcode: string;
  partnerOptionCode: string;
  productName: string;
  optionName: string;
  isActive: boolean;
};

export type ProductMasterShoplingDiagnosticIssueCode =
  | "SHOPLING_BARCODE_CONFLICT"
  | "DUPLICATE_SHOPLING_IDENTITY"
  | "SHOPLING_BARCODE_NOT_IN_PRODUCT_MASTER"
  | "PRODUCT_MASTER_BARCODE_NOT_ACTIVE_IN_SHOPLING"
  | "MISSING_PRODUCT_MASTER_LISTING"
  | "STALE_PRODUCT_MASTER_LISTING"
  | "INVALID_UNITS_PER_ORDER"
  | "UNITS_PER_ORDER_MISMATCH"
  | "PACK_RATIO_AMBIGUOUS";

export type ProductMasterShoplingDiagnosticIssue = {
  severity: "BLOCKER" | "REVIEW";
  code: ProductMasterShoplingDiagnosticIssueCode;
  skuId: string | null;
  barcode: string;
  modelNo: string | null;
  goodsKey: string | null;
  optionId: string | null;
  productName: string;
  optionName: string;
  existingUnitsPerOrder: number | null;
  expectedUnitsPerOrder: number | null;
  message: string;
};

export type ProductMasterShoplingMappingCandidate = {
  skuId: string;
  barcode: string;
  modelNo: string | null;
  goodsKey: string;
  optionId: string;
  productName: string;
  optionName: string;
  expectedUnitsPerOrder: number | null;
  inference: "DEFAULT_SINGLE" | "EXPLICIT_PACK_RATIO" | "AMBIGUOUS";
  evidence: string[];
};

export type ProductMasterShoplingDiagnosticReport = {
  generatedAt: string;
  summary: {
    planningSkuCount: number;
    shoplingActiveOptionCount: number;
    managedShoplingOptionCount: number;
    ignoredUnmanagedOptionCount: number;
    matchedSkuCount: number;
    exactListingMatchCount: number;
    missingListingCandidateCount: number;
    staleListingCount: number;
    unitsMismatchCount: number;
    orphanManagedOptionCount: number;
    barcodeConflictCount: number;
    duplicateShoplingIdentityCount: number;
    blockerCount: number;
    reviewCount: number;
    readyForMappingReview: boolean;
  };
  candidates: ProductMasterShoplingMappingCandidate[];
  issues: ProductMasterShoplingDiagnosticIssue[];
};

type PackSignal = {
  quantity: number;
  evidence: string;
};

type UnitsInference = {
  expected: number | null;
  kind: ProductMasterShoplingMappingCandidate["inference"];
  evidence: string[];
};

const MANAGED_BARCODE = /^[A-Z]{3}\d+-\d+$/;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function managedBarcode(value: unknown) {
  const normalized = normalizeShoplingBarcode(value);
  return MANAGED_BARCODE.test(normalized) ? normalized : "";
}

function listingIdentity(value: {
  goodsKey?: string | null;
  optionId?: string | null;
  optionName?: string | null;
}) {
  const goodsKey = text(value.goodsKey).toUpperCase();
  const optionId = text(value.optionId).toUpperCase();
  const optionName = text(value.optionName).toUpperCase();
  if (!goodsKey) return "";
  return `${goodsKey}\u0000${optionId || `NAME:${optionName || "단품"}`}`;
}

function packSignal(value: string): PackSignal | null {
  const source = text(value).replace(/\s+/g, " ");
  if (!source) return null;

  const plus = source.match(
    /(?:^|[^\d])(\d{1,3})\s*\+\s*(\d{1,3})(?:[^\d]|$)/,
  );
  if (plus) {
    const quantity = Number(plus[1]) + Number(plus[2]);
    if (quantity >= 2 && quantity <= 1_000) {
      return { quantity, evidence: plus[0].trim() };
    }
  }

  const explicit = source.match(
    /(?:^|[^\d])(\d{1,3})\s*(?:개\s*(?:입|세트|묶음|구성|팩|발송)|입\s*(?:세트|구성)|(?:PCS?|PIECES?)\b)(?:[^\d]|$)/i,
  );
  if (explicit) {
    const quantity = Number(explicit[1]);
    if (quantity >= 2 && quantity <= 1_000) {
      return { quantity, evidence: explicit[0].trim() };
    }
  }

  return null;
}

function inferUnitsPerOrder(
  sku: DiagnosticPlanningSku,
  option: DiagnosticShoplingOption,
): UnitsInference {
  const skuSignal = packSignal(`${sku.productName} ${sku.optionName ?? ""}`);
  const listingSignal = packSignal(
    `${option.productName} ${option.optionName}`,
  );

  if (!listingSignal && !skuSignal) {
    return {
      expected: 1,
      kind: "DEFAULT_SINGLE",
      evidence: ["상품마스터와 Shopling 모두 별도 묶음 표기가 없어 단품 1개로 판단"],
    };
  }

  if (!listingSignal && skuSignal) {
    return {
      expected: 1,
      kind: "DEFAULT_SINGLE",
      evidence: [
        `상품마스터 자체 포장단위 ${skuSignal.quantity}개(${skuSignal.evidence})를 재고 1단위로 판단`,
      ],
    };
  }

  const listingQuantity = listingSignal?.quantity ?? 1;
  const skuQuantity = skuSignal?.quantity ?? 1;
  if (listingQuantity < skuQuantity || listingQuantity % skuQuantity !== 0) {
    return {
      expected: null,
      kind: "AMBIGUOUS",
      evidence: [
        `Shopling 구성 ${listingQuantity}개(${listingSignal?.evidence ?? ""})`,
        `상품마스터 기본단위 ${skuQuantity}개(${skuSignal?.evidence ?? "단품"})`,
        "두 포장단위가 나누어떨어지지 않아 자동 환산하지 않음",
      ],
    };
  }

  const expected = Math.max(1, listingQuantity / skuQuantity);
  return {
    expected,
    kind: "EXPLICIT_PACK_RATIO",
    evidence: [
      `Shopling 구성 ${listingQuantity}개(${listingSignal?.evidence ?? ""})`,
      `상품마스터 기본단위 ${skuQuantity}개(${skuSignal?.evidence ?? "단품"})`,
      `판매 1건당 재고 ${expected}단위로 환산`,
    ],
  };
}

function safeUnits(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function issueKey(issue: ProductMasterShoplingDiagnosticIssue) {
  return [
    issue.code,
    issue.skuId ?? "",
    issue.barcode,
    issue.goodsKey ?? "",
    issue.optionId ?? "",
  ].join("\u0000");
}

function addIssue(
  target: Map<string, ProductMasterShoplingDiagnosticIssue>,
  issue: ProductMasterShoplingDiagnosticIssue,
) {
  target.set(issueKey(issue), issue);
}

export function buildProductMasterShoplingDiagnostic(
  planningSkus: DiagnosticPlanningSku[],
  shoplingOptions: DiagnosticShoplingOption[],
  generatedAt = new Date().toISOString(),
): ProductMasterShoplingDiagnosticReport {
  const skus = planningSkus
    .filter((sku) => sku.skuActive !== false)
    .map((sku) => ({ ...sku, barcode: managedBarcode(sku.barcode) }))
    .filter((sku) => Boolean(sku.barcode));
  const activeOptions = shoplingOptions.filter((option) => option.isActive);
  const skuByBarcode = new Map(skus.map((sku) => [sku.barcode, sku]));
  const activeOptionByIdentity = new Map<string, DiagnosticShoplingOption>();
  const identityBarcodes = new Map<string, Set<string>>();
  const shoplingByBarcode = new Map<string, DiagnosticShoplingOption[]>();
  const conflicts = new Set<string>();
  const issues = new Map<string, ProductMasterShoplingDiagnosticIssue>();
  const candidates: ProductMasterShoplingMappingCandidate[] = [];
  let ignoredUnmanagedOptionCount = 0;

  for (const option of activeOptions) {
    const barcode = managedBarcode(option.barcode);
    const partnerOptionCode = managedBarcode(option.partnerOptionCode);
    const identity = listingIdentity(option);
    if (barcode && partnerOptionCode && barcode !== partnerOptionCode) {
      conflicts.add(identity || `${option.goodsKey}:${option.optionId}`);
      addIssue(issues, {
        severity: "BLOCKER",
        code: "SHOPLING_BARCODE_CONFLICT",
        skuId: null,
        barcode,
        modelNo: null,
        goodsKey: option.goodsKey || null,
        optionId: option.optionId || null,
        productName: option.productName,
        optionName: option.optionName,
        existingUnitsPerOrder: null,
        expectedUnitsPerOrder: null,
        message: `Shopling 옵션바코드 ${barcode}와 옵션자체관리코드 ${partnerOptionCode}가 서로 다릅니다.`,
      });
      continue;
    }
    const managed = barcode || partnerOptionCode;
    if (!managed) {
      ignoredUnmanagedOptionCount += 1;
      continue;
    }
    if (identity) {
      const owners = identityBarcodes.get(identity) ?? new Set<string>();
      owners.add(managed);
      identityBarcodes.set(identity, owners);
      if (!activeOptionByIdentity.has(identity)) {
        activeOptionByIdentity.set(identity, option);
      }
    }
    shoplingByBarcode.set(managed, [
      ...(shoplingByBarcode.get(managed) ?? []),
      { ...option, barcode: managed },
    ]);
  }

  for (const [identity, barcodes] of identityBarcodes) {
    if (barcodes.size <= 1) continue;
    const option = activeOptionByIdentity.get(identity);
    addIssue(issues, {
      severity: "BLOCKER",
      code: "DUPLICATE_SHOPLING_IDENTITY",
      skuId: null,
      barcode: [...barcodes].sort().join(", "),
      modelNo: null,
      goodsKey: option?.goodsKey || null,
      optionId: option?.optionId || null,
      productName: option?.productName || "",
      optionName: option?.optionName || "",
      existingUnitsPerOrder: null,
      expectedUnitsPerOrder: null,
      message: "같은 Shopling goods_key·옵션 ID가 서로 다른 위치코드에 연결되어 있습니다.",
    });
  }

  let exactListingMatchCount = 0;
  let staleListingCount = 0;
  let unitsMismatchCount = 0;
  let orphanManagedOptionCount = 0;
  const matchedSkuIds = new Set<string>();
  const candidateKeys = new Set<string>();

  for (const [barcode, options] of shoplingByBarcode) {
    const sku = skuByBarcode.get(barcode);
    if (!sku) {
      orphanManagedOptionCount += options.length;
      for (const option of options) {
        addIssue(issues, {
          severity: "REVIEW",
          code: "SHOPLING_BARCODE_NOT_IN_PRODUCT_MASTER",
          skuId: null,
          barcode,
          modelNo: null,
          goodsKey: option.goodsKey || null,
          optionId: option.optionId || null,
          productName: option.productName,
          optionName: option.optionName,
          existingUnitsPerOrder: null,
          expectedUnitsPerOrder: null,
          message: "Shopling에는 위치코드가 있지만 상품마스터에서 같은 바코드를 찾지 못했습니다.",
        });
      }
      continue;
    }
    matchedSkuIds.add(sku.skuId);
    const activeListings = (sku.listings ?? []).filter(
      (listing) => listing.active !== false,
    );
    const listingByIdentity = new Map(
      activeListings.map((listing) => [listingIdentity(listing), listing]),
    );

    for (const option of options) {
      const identity = listingIdentity(option);
      const existing = identity ? listingByIdentity.get(identity) : undefined;
      const inference = inferUnitsPerOrder(sku, option);
      if (existing) {
        exactListingMatchCount += 1;
        const existingUnits = safeUnits(existing.unitsPerOrder);
        if (!existingUnits) {
          addIssue(issues, {
            severity: "BLOCKER",
            code: "INVALID_UNITS_PER_ORDER",
            skuId: sku.skuId,
            barcode,
            modelNo: text(sku.modelNo) || null,
            goodsKey: option.goodsKey || null,
            optionId: option.optionId || null,
            productName: option.productName,
            optionName: option.optionName,
            existingUnitsPerOrder: null,
            expectedUnitsPerOrder: inference.expected,
            message: "상품마스터의 판매 1건당 재고 환산수량이 1 이상의 정수가 아닙니다.",
          });
        } else if (
          inference.expected !== null &&
          existingUnits !== inference.expected
        ) {
          unitsMismatchCount += 1;
          addIssue(issues, {
            severity: "REVIEW",
            code: "UNITS_PER_ORDER_MISMATCH",
            skuId: sku.skuId,
            barcode,
            modelNo: text(sku.modelNo) || null,
            goodsKey: option.goodsKey || null,
            optionId: option.optionId || null,
            productName: option.productName,
            optionName: option.optionName,
            existingUnitsPerOrder: existingUnits,
            expectedUnitsPerOrder: inference.expected,
            message: `현재 환산수량은 ${existingUnits}개지만 상품마스터 포장단위와 Shopling 판매구성 비교값은 ${inference.expected}개입니다.`,
          });
        } else if (inference.expected === null) {
          addIssue(issues, {
            severity: "REVIEW",
            code: "PACK_RATIO_AMBIGUOUS",
            skuId: sku.skuId,
            barcode,
            modelNo: text(sku.modelNo) || null,
            goodsKey: option.goodsKey || null,
            optionId: option.optionId || null,
            productName: option.productName,
            optionName: option.optionName,
            existingUnitsPerOrder: existingUnits,
            expectedUnitsPerOrder: null,
            message: "상품마스터 포장단위와 Shopling 판매구성이 나누어떨어지지 않아 수동 확인이 필요합니다.",
          });
        }
        continue;
      }

      const candidateKey = `${sku.skuId}\u0000${identity}`;
      if (!candidateKeys.has(candidateKey)) {
        candidateKeys.add(candidateKey);
        candidates.push({
          skuId: sku.skuId,
          barcode,
          modelNo: text(sku.modelNo) || null,
          goodsKey: option.goodsKey,
          optionId: option.optionId,
          productName: option.productName,
          optionName: option.optionName,
          expectedUnitsPerOrder: inference.expected,
          inference: inference.kind,
          evidence: inference.evidence,
        });
      }
      addIssue(issues, {
        severity: "REVIEW",
        code: "MISSING_PRODUCT_MASTER_LISTING",
        skuId: sku.skuId,
        barcode,
        modelNo: text(sku.modelNo) || null,
        goodsKey: option.goodsKey || null,
        optionId: option.optionId || null,
        productName: option.productName,
        optionName: option.optionName,
        existingUnitsPerOrder: null,
        expectedUnitsPerOrder: inference.expected,
        message:
          inference.expected === null
            ? "바코드는 일치하지만 Shopling 판매옵션 연결과 환산수량을 수동 확인해야 합니다."
            : `바코드는 일치하지만 상품마스터 판매옵션 연결이 없습니다. 권장 환산수량은 ${inference.expected}개입니다.`,
      });
    }
  }

  for (const sku of skus) {
    const activeListings = (sku.listings ?? []).filter(
      (listing) => listing.active !== false,
    );
    if (!shoplingByBarcode.has(sku.barcode)) {
      addIssue(issues, {
        severity: "REVIEW",
        code: "PRODUCT_MASTER_BARCODE_NOT_ACTIVE_IN_SHOPLING",
        skuId: sku.skuId,
        barcode: sku.barcode,
        modelNo: text(sku.modelNo) || null,
        goodsKey: null,
        optionId: null,
        productName: sku.productName,
        optionName: text(sku.optionName),
        existingUnitsPerOrder: null,
        expectedUnitsPerOrder: null,
        message: "상품마스터 위치코드와 일치하는 활성 Shopling 옵션을 찾지 못했습니다.",
      });
    }
    for (const listing of activeListings) {
      const identity = listingIdentity(listing);
      if (!identity || activeOptionByIdentity.has(identity)) continue;
      staleListingCount += 1;
      addIssue(issues, {
        severity: "REVIEW",
        code: "STALE_PRODUCT_MASTER_LISTING",
        skuId: sku.skuId,
        barcode: sku.barcode,
        modelNo: text(sku.modelNo) || null,
        goodsKey: text(listing.goodsKey) || null,
        optionId: text(listing.optionId) || null,
        productName: sku.productName,
        optionName: text(sku.optionName),
        existingUnitsPerOrder: safeUnits(listing.unitsPerOrder),
        expectedUnitsPerOrder: null,
        message: "상품마스터에는 활성 연결이 있지만 현재 Shopling 활성 옵션에서 같은 goods_key·옵션 ID를 찾지 못했습니다.",
      });
    }
  }

  const issueRows = [...issues.values()].sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === "BLOCKER" ? -1 : 1;
    }
    return [left.barcode, left.goodsKey ?? "", left.optionId ?? "", left.code]
      .join("\u0000")
      .localeCompare(
        [right.barcode, right.goodsKey ?? "", right.optionId ?? "", right.code].join("\u0000"),
        "ko",
      );
  });
  candidates.sort((left, right) =>
    [left.barcode, left.goodsKey, left.optionId]
      .join("\u0000")
      .localeCompare(
        [right.barcode, right.goodsKey, right.optionId].join("\u0000"),
        "ko",
      ),
  );
  const blockerCount = issueRows.filter(
    (issue) => issue.severity === "BLOCKER",
  ).length;
  const reviewCount = issueRows.length - blockerCount;
  const managedShoplingOptionCount = [...shoplingByBarcode.values()].reduce(
    (sum, options) => sum + options.length,
    0,
  );

  return {
    generatedAt,
    summary: {
      planningSkuCount: skus.length,
      shoplingActiveOptionCount: activeOptions.length,
      managedShoplingOptionCount,
      ignoredUnmanagedOptionCount,
      matchedSkuCount: matchedSkuIds.size,
      exactListingMatchCount,
      missingListingCandidateCount: candidates.length,
      staleListingCount,
      unitsMismatchCount,
      orphanManagedOptionCount,
      barcodeConflictCount: conflicts.size,
      duplicateShoplingIdentityCount: [...identityBarcodes.values()].filter(
        (barcodes) => barcodes.size > 1,
      ).length,
      blockerCount,
      reviewCount,
      readyForMappingReview: blockerCount === 0,
    },
    candidates,
    issues: issueRows,
  };
}
