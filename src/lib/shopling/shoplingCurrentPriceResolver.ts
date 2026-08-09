export const SHOPLING_CURRENT_PRICE_LOOKUP_BATCH_SIZE = 50;
const GOODS_KEY = /^\d+$/;
const PRODUCT_GROUP_BY_SUFFIX: Record<string, string> = {
  a: "도매1",
  b: "도매2",
  c: "도매3",
  d: "도매4",
  e: "소매1",
  f: "소매2",
};

export type ShoplingCurrentPriceState = "READY" | "MISSING" | "CONFLICT";

export type ShoplingCurrentPriceListing = {
  goodsKey: string;
  optionId: string;
  ptnGoodsCd: string;
  productGroup: string;
  baseSalePrice: number;
  optionAmount: number;
  effectiveSalePrice: number;
  originalCost: number;
  listPrice: number;
  saleStatus: string;
};

export type ShoplingCurrentPriceRow = {
  barcode: string;
  state: ShoplingCurrentPriceState;
  priceMode: "UNIFORM" | "GROUPED" | "UNRESOLVED";
  currentSalePrice: number;
  goodsKeys: string[];
  mappedListingCount: number;
  unresolvedListingCount: number;
  conflictListingCount: number;
  distinctPrices: number[];
  listings: ShoplingCurrentPriceListing[];
};

export type ShoplingCurrentPriceSnapshot = {
  generatedAt: string;
  state: "READY" | "PARTIAL" | "BLOCKED";
  productCount: number;
  readyCount: number;
  missingCount: number;
  conflictCount: number;
  queriedGoodsKeyCount: number;
  sourceRowCount: number;
  writesEnabled: false;
  rows: ShoplingCurrentPriceRow[];
};

export type ShoplingCurrentPricePlanningListing = {
  goodsKey?: string | null;
  optionId?: string | null;
  active?: boolean;
};

export type ShoplingCurrentPricePlanningProduct = {
  barcode: string;
  skuActive?: boolean;
  listings?: ShoplingCurrentPricePlanningListing[];
};

type RawRow = Record<string, unknown>;

type ShoplingProductLookupConfig = {
  loginId: string;
  companyId: string;
  authKey: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function cdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

export function buildShoplingProductIdLookupXml(
  config: ShoplingProductLookupConfig,
  goodsKeys: string[],
  productFields: string,
) {
  const normalized = [
    ...new Set(goodsKeys.map(text).filter((key) => GOODS_KEY.test(key))),
  ];
  if (
    !normalized.length ||
    normalized.length > SHOPLING_CURRENT_PRICE_LOOKUP_BATCH_SIZE
  ) {
    throw new Error("SHOPLING_PRODUCT_ID_LOOKUP_BATCH_INVALID");
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<reqst><apiProdGather>",
    `<login_id>${cdata(config.loginId)}</login_id>`,
    `<company_id>${cdata(config.companyId)}</company_id>`,
    `<api_auth_key>${cdata(config.authKey)}</api_auth_key>`,
    `<prod_id>${cdata(normalized.join(","))}</prod_id>`,
    `<prod_fields>${cdata(productFields)}</prod_fields>`,
    "<opt_yn>Y</opt_yn><attri_yn>N</attri_yn>",
    "</apiProdGather></reqst>",
  ].join("");
}

function goodsKey(row: RawRow) {
  return text(row.goods_key);
}

function optionId(row: RawRow) {
  return text(row.optId);
}

function effectiveSalePrice(row: RawRow) {
  const base = integer(row.sale_price);
  if (!base) return 0;
  return base + integer(row.optAmt);
}

function productGroup(row: RawRow) {
  const ptnGoodsCd = text(row.ptn_goods_cd).toLowerCase();
  return PRODUCT_GROUP_BY_SUFFIX[ptnGoodsCd.slice(-1)] ?? "";
}

function activeListings(product: ShoplingCurrentPricePlanningProduct) {
  return (product.listings ?? []).filter((row) => row.active !== false);
}

function candidateRowsForListing(
  rows: RawRow[],
  listing: ShoplingCurrentPricePlanningListing,
) {
  const key = text(listing.goodsKey);
  const option = text(listing.optionId);
  const byGoodsKey = rows.filter((row) => goodsKey(row) === key);
  if (!option) return byGoodsKey;
  return byGoodsKey.filter((row) => optionId(row) === option);
}

function normalizedListing(row: RawRow): ShoplingCurrentPriceListing {
  return {
    goodsKey: goodsKey(row),
    optionId: optionId(row),
    ptnGoodsCd: text(row.ptn_goods_cd),
    productGroup: productGroup(row),
    baseSalePrice: integer(row.sale_price),
    optionAmount: integer(row.optAmt),
    effectiveSalePrice: effectiveSalePrice(row),
    originalCost: integer(row.org_price),
    listPrice: integer(row.list_price),
    saleStatus: text(row.sale_status),
  };
}

export function currentPriceGoodsKeys(
  products: ShoplingCurrentPricePlanningProduct[],
) {
  return [
    ...new Set(
      products.flatMap((product) =>
        activeListings(product)
          .map((listing) => text(listing.goodsKey))
          .filter((key) => GOODS_KEY.test(key)),
      ),
    ),
  ].sort((left, right) => Number(left) - Number(right));
}

export function resolveShoplingCurrentPrices(
  products: ShoplingCurrentPricePlanningProduct[],
  sourceRows: RawRow[],
  generatedAt = new Date().toISOString(),
): ShoplingCurrentPriceSnapshot {
  const rows = products
    .filter((product) => product.skuActive !== false)
    .map((product): ShoplingCurrentPriceRow => {
      const planningListings = activeListings(product).filter((listing) =>
        GOODS_KEY.test(text(listing.goodsKey)),
      );
      const resolved: ShoplingCurrentPriceListing[] = [];
      let unresolvedListingCount = 0;
      let conflictListingCount = 0;

      for (const listing of planningListings) {
        const candidates = candidateRowsForListing(sourceRows, listing).filter(
          (row) => effectiveSalePrice(row) > 0,
        );
        const prices = [...new Set(candidates.map(effectiveSalePrice))];
        if (!candidates.length) {
          unresolvedListingCount += 1;
          continue;
        }
        if (prices.length !== 1) {
          conflictListingCount += 1;
          continue;
        }
        const exact = candidates.find(
          (row) => effectiveSalePrice(row) === prices[0],
        );
        if (!exact) {
          unresolvedListingCount += 1;
          continue;
        }
        resolved.push(normalizedListing(exact));
      }

      const distinctPrices = [
        ...new Set(resolved.map((row) => row.effectiveSalePrice)),
      ].sort((left, right) => left - right);
      const state: ShoplingCurrentPriceState =
        conflictListingCount > 0
          ? "CONFLICT"
          : !planningListings.length ||
              unresolvedListingCount > 0 ||
              !resolved.length
            ? "MISSING"
            : "READY";
      const priceMode =
        state !== "READY"
          ? "UNRESOLVED"
          : distinctPrices.length === 1
            ? "UNIFORM"
            : "GROUPED";
      return {
        barcode: text(product.barcode).toUpperCase().replace(/\s+/g, ""),
        state,
        priceMode,
        currentSalePrice:
          state === "READY" && distinctPrices.length === 1
            ? distinctPrices[0]
            : 0,
        goodsKeys: [
          ...new Set(planningListings.map((listing) => text(listing.goodsKey))),
        ].sort(),
        mappedListingCount: resolved.length,
        unresolvedListingCount,
        conflictListingCount,
        distinctPrices,
        listings: resolved.sort(
          (left, right) =>
            left.goodsKey.localeCompare(right.goodsKey) ||
            left.optionId.localeCompare(right.optionId),
        ),
      };
    })
    .sort((left, right) => left.barcode.localeCompare(right.barcode));

  const readyCount = rows.filter((row) => row.state === "READY").length;
  const missingCount = rows.filter((row) => row.state === "MISSING").length;
  const conflictCount = rows.filter((row) => row.state === "CONFLICT").length;
  const queriedGoodsKeys = currentPriceGoodsKeys(products);

  return {
    generatedAt,
    state:
      readyCount === rows.length && rows.length > 0
        ? "READY"
        : readyCount > 0
          ? "PARTIAL"
          : "BLOCKED",
    productCount: rows.length,
    readyCount,
    missingCount,
    conflictCount,
    queriedGoodsKeyCount: queriedGoodsKeys.length,
    sourceRowCount: sourceRows.length,
    writesEnabled: false,
    rows,
  };
}
