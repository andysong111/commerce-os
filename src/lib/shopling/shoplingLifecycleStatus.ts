import { buildShoplingProductIdLookupXml } from "@/lib/shopling/shoplingCurrentPriceResolver";
import { parseShoplingReadResponse, shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

const LOOKUP_BATCH_SIZE = 50;
const GOODS_KEY = /^\d+$/;
const PRODUCT_FIELDS = ["goods_key", "ptn_goods_cd", "prod_nm", "sale_status"].join(",");

type RawRow = Record<string, unknown>;

export type ShoplingLifecycleStatusItem = {
  goodsKey: string;
  ptnGoodsCd: string;
  productName: string;
  saleStatus: string;
  canonicalSaleStatus: string;
};

export type ShoplingLifecycleGoodsStatus = {
  goodsKey: string;
  state: "READY" | "MISSING" | "CONFLICT";
  currentSaleStatus: string;
  rawSaleStatuses: string[];
  items: ShoplingLifecycleStatusItem[];
};

export type ShoplingLifecycleStatusSnapshot = {
  generatedAt: string;
  requestedGoodsKeyCount: number;
  sourceRowCount: number;
  writesEnabled: false;
  statusCounts: Record<string, number>;
  items: ShoplingLifecycleStatusItem[];
  statuses: ShoplingLifecycleGoodsStatus[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
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

export function canonicalShoplingSaleStatus(value: unknown) {
  const status = text(value).toUpperCase();
  if (["B", "SELLING", "판매중"].includes(status)) return "B";
  if (["C", "SOLD_OUT", "SOLDOUT", "품절"].includes(status)) return "C";
  if (["Z", "DELETE", "DELETED", "삭제"].includes(status)) return "Z";
  return status;
}

export function normalizeLifecycleGoodsKeys(value: unknown, max = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(value)) return [];
  const normalized = [...new Set(value.map(text).filter((key) => GOODS_KEY.test(key)))];
  return normalized.slice(0, Math.max(0, max));
}

function normalizedRow(row: RawRow): ShoplingLifecycleStatusItem {
  const saleStatus = text(row.sale_status);
  return {
    goodsKey: text(row.goods_key),
    ptnGoodsCd: text(row.ptn_goods_cd),
    productName: text(row.prod_nm),
    saleStatus,
    canonicalSaleStatus: canonicalShoplingSaleStatus(saleStatus),
  };
}

function batches(values: string[]) {
  const output: string[][] = [];
  for (let index = 0; index < values.length; index += LOOKUP_BATCH_SIZE) {
    output.push(values.slice(index, index + LOOKUP_BATCH_SIZE));
  }
  return output;
}

export function resolveShoplingLifecycleStatuses(
  goodsKeys: string[],
  sourceRows: RawRow[],
  generatedAt = new Date().toISOString(),
): ShoplingLifecycleStatusSnapshot {
  const requested = normalizeLifecycleGoodsKeys(goodsKeys);
  const requestedSet = new Set(requested);
  const items = sourceRows
    .map(normalizedRow)
    .filter((row) => requestedSet.has(row.goodsKey));
  const uniqueItems = [...new Map(
    items.map((row) => [
      `${row.goodsKey}\u0000${row.ptnGoodsCd}\u0000${row.saleStatus}`,
      row,
    ]),
  ).values()].sort(
    (left, right) => Number(left.goodsKey) - Number(right.goodsKey) || left.ptnGoodsCd.localeCompare(right.ptnGoodsCd),
  );

  const statusCounts = uniqueItems.reduce<Record<string, number>>((counts, row) => {
    const key = row.canonicalSaleStatus || "UNKNOWN";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  const statuses = requested.map((goodsKey): ShoplingLifecycleGoodsStatus => {
    const matched = uniqueItems.filter((row) => row.goodsKey === goodsKey);
    const rawSaleStatuses = [...new Set(matched.map((row) => row.saleStatus).filter(Boolean))].sort();
    const canonicalStatuses = [...new Set(matched.map((row) => row.canonicalSaleStatus).filter(Boolean))].sort();
    return {
      goodsKey,
      state: canonicalStatuses.length === 1 ? "READY" : canonicalStatuses.length > 1 ? "CONFLICT" : "MISSING",
      currentSaleStatus: canonicalStatuses.length === 1 ? canonicalStatuses[0] : "",
      rawSaleStatuses,
      items: matched,
    };
  });

  return {
    generatedAt,
    requestedGoodsKeyCount: requested.length,
    sourceRowCount: items.length,
    writesEnabled: false,
    statusCounts,
    items: uniqueItems,
    statuses,
  };
}

export async function loadShoplingLifecycleStatusSnapshot(goodsKeys: string[]) {
  const requested = normalizeLifecycleGoodsKeys(goodsKeys);
  if (!requested.length) return resolveShoplingLifecycleStatuses([], []);
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const rows: RawRow[] = [];
  for (const batch of batches(requested)) {
    const xml = buildShoplingProductIdLookupXml(config, batch, PRODUCT_FIELDS);
    const response = await postShoplingXml(config.productsUrl, xml, {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-shopling-lifecycle-status/1.0",
      },
      timeoutMs: 45_000,
    });
    if (!response.ok) throw new Error(`SHOPLING_LIFECYCLE_STATUS_HTTP_${response.status}`);
    const body = await response.text();
    rows.push(...(parseShoplingReadResponse("products", body) as RawRow[]));
  }
  return resolveShoplingLifecycleStatuses(requested, rows);
}
