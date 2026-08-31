import { buildShoplingProductIdLookupXml } from "@/lib/shopling/shoplingCurrentPriceResolver";
import { parseShoplingReadResponse, shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GOODS_KEYS = 50;
const GOODS_KEY = /^\d+$/;
const PRODUCT_FIELDS = ["goods_key", "ptn_goods_cd", "prod_nm", "sale_status"].join(",");

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function normalizeGoodsKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter((key) => GOODS_KEY.test(key)))];
}

function normalizedRow(row: Record<string, unknown>) {
  return {
    goodsKey: text(row.goods_key),
    ptnGoodsCd: text(row.ptn_goods_cd),
    productName: text(row.prod_nm),
    saleStatus: text(row.sale_status),
  };
}

export async function POST(request: Request) {
  const payload = object(await request.json().catch(() => null));
  const goodsKeys = normalizeGoodsKeys(payload.goodsKeys);
  if (!goodsKeys.length || goodsKeys.length > MAX_GOODS_KEYS) {
    return Response.json(
      { ok: false, error: "invalid_goods_keys", maxGoodsKeys: MAX_GOODS_KEYS },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const config = shoplingReadConfigFromEnv(shoplingEnvironment());
    const xml = buildShoplingProductIdLookupXml(config, goodsKeys, PRODUCT_FIELDS);
    const response = await postShoplingXml(config.productsUrl, xml, {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-shopling-lifecycle-status-probe/1.0",
      },
      timeoutMs: 45_000,
    });
    if (!response.ok) {
      return Response.json(
        { ok: false, error: "shopling_status_probe_http_error", status: response.status },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }

    const body = await response.text();
    const rows = (parseShoplingReadResponse("products", body) as Record<string, unknown>[])
      .map(normalizedRow)
      .filter((row) => goodsKeys.includes(row.goodsKey));
    const unique = [...new Map(rows.map((row) => [`${row.goodsKey}\u0000${row.ptnGoodsCd}\u0000${row.saleStatus}`, row])).values()]
      .sort((left, right) => Number(left.goodsKey) - Number(right.goodsKey) || left.ptnGoodsCd.localeCompare(right.ptnGoodsCd));
    const statusCounts = unique.reduce<Record<string, number>>((counts, row) => {
      counts[row.saleStatus || "UNKNOWN"] = (counts[row.saleStatus || "UNKNOWN"] ?? 0) + 1;
      return counts;
    }, {});

    return Response.json(
      {
        ok: true,
        writesEnabled: false,
        requestedGoodsKeyCount: goodsKeys.length,
        sourceRowCount: rows.length,
        statusCounts,
        items: unique,
      },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "shopling_status_probe_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
