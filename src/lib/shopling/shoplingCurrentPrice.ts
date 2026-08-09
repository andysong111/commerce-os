import { parseShoplingReadResponse, shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";
import type { PlanningProduct } from "@/lib/shopling/shoplingLiveAggregation";

const PRODUCT_FIELDS = [
  "goods_key",
  "ptn_goods_cd",
  "prod_nm",
  "org_price",
  "sale_price",
  "list_price",
  "model_no",
  "sale_status",
].join(",");
const LOOKUP_BATCH_SIZE = 50;
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

type RawRow = Record<string, unknown>;

type Listing = {
  goodsKey?: string | null;
  optionId?: string | null;
  active?: boolean;
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

function shoplingEnvironment() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

export function buildShoplingProductIdLookupXml(
  config: { loginId: string; companyId: string; authKey: string },
  goodsKeys: string[],
) {
  const normalized = [
    ...new Set(goodsKeys.map(text).filter((key) => GOODS_KEY.test(key))),
  ];
  if (!normalized.length || normalized.length > LOOKUP_BATCH_SIZE) {
    throw new Error("SHOPLING_PRODUCT_ID_LOOKUP_BATCH_INVALID");
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<reqst><apiProdGather>",
    `<login_id>${cdata(config.loginId)}</login_id>`,
    `<company_id>${cdata(config.companyId)}</company_id>`,
    `<api_auth_key>${cdata(config.authKey)}</api_auth_key>`,
    `<prod_id>${cdata(normalized.join(","))}</prod_id>`,
    `<prod_fields>${cdata(PRODUCT_FIELDS)}</prod_fields>`,
    "<opt_yn>Y</opt_yn><attri_yn>N</attri_yn>",
    "</apiProdGather></reqst>",
  ].join("");
}

function batches(values: string[]) {
  const output: string[][] = [];
  for (let index = 0; index < values.length; index += LOOKUP_BATCH_SIZE) {
    output.push(values.slice(index, index + LOOKUP_BATCH_SIZE));
  }
  return output;
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

function activeListings(product: PlanningProduct): Listing[] {
  return (product.listings ?? []).filter((row) => row.active !== false);
}

function candidateRowsForListing(rows: RawRow[], listing: Listing) {
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

export function resolveShoplingCurrentPrices(
  products: PlanningProduct[],
  sourceRows: RawRow[],
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
  const queriedGoodsKeys = new Set(
    products.flatMap((product) =>
      activeListings(product)
        .map((listing) => text(listing.goodsKey))
        .filter((key) => GOODS_KEY.test(key)),
    ),
  );

  return {
    generatedAt: new Date().toISOString(),
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
    queriedGoodsKeyCount: queriedGoodsKeys.size,
    sourceRowCount: sourceRows.length,
    writesEnabled: false,
    rows,
  };
}

export async function loadShoplingCurrentPriceSnapshot(
  products: PlanningProduct[],
): Promise<ShoplingCurrentPriceSnapshot> {
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const goodsKeys = [
    ...new Set(
      products.flatMap((product) =>
        activeListings(product)
          .map((listing) => text(listing.goodsKey))
          .filter((key) => GOODS_KEY.test(key)),
      ),
    ),
  ].sort((left, right) => Number(left) - Number(right));
  if (!goodsKeys.length) {
    return resolveShoplingCurrentPrices(products, []);
  }

  const sourceRows: RawRow[] = [];
  for (const batch of batches(goodsKeys)) {
    const xml = buildShoplingProductIdLookupXml(config, batch);
    const response = await postShoplingXml(config.productsUrl, xml, {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-ops-center-shopling-current-price/1.0",
      },
      timeoutMs: 45_000,
    });
    if (!response.ok) {
      throw new Error(`SHOPLING_CURRENT_PRICE_HTTP_${response.status}`);
    }
    const body = await response.text();
    sourceRows.push(
      ...(parseShoplingReadResponse("products", body) as RawRow[]),
    );
  }
  return resolveShoplingCurrentPrices(products, sourceRows);
}
