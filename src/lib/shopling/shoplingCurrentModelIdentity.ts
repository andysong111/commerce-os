import { parseShoplingReadResponse, shoplingReadConfigFromEnv } from "@/lib/shopling/shoplingReadClient";
import {
  SHOPLING_CURRENT_MODEL_LOOKUP_BATCH_SIZE,
  buildShoplingCurrentModelLookupXml,
  resolveShoplingCurrentModelIdentities,
  type ShoplingCurrentModelSnapshot,
} from "@/lib/shopling/shoplingCurrentModelIdentityResolver";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

export {
  buildShoplingCurrentModelLookupXml,
  isExactAaaModelNo,
  normalizeShoplingModelNo,
  resolveShoplingCurrentModelIdentities,
  type ShoplingCurrentModelGoodsKeyRow,
  type ShoplingCurrentModelGoodsKeyState,
  type ShoplingCurrentModelSnapshot,
} from "@/lib/shopling/shoplingCurrentModelIdentityResolver";

const PRODUCT_FIELDS = [
  "goods_key",
  "ptn_goods_cd",
  "prod_nm",
  "model_no",
  "model_nm",
  "sale_status",
].join(",");

type RawRow = Record<string, unknown>;

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

function batches(values: string[]) {
  const output: string[][] = [];
  for (
    let index = 0;
    index < values.length;
    index += SHOPLING_CURRENT_MODEL_LOOKUP_BATCH_SIZE
  ) {
    output.push(
      values.slice(index, index + SHOPLING_CURRENT_MODEL_LOOKUP_BATCH_SIZE),
    );
  }
  return output;
}

export async function loadShoplingCurrentModelSnapshot(
  goodsKeys: string[],
): Promise<ShoplingCurrentModelSnapshot> {
  const normalizedGoodsKeys = [
    ...new Set(
      goodsKeys
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value)),
    ),
  ].sort((left, right) => Number(left) - Number(right));
  if (!normalizedGoodsKeys.length) {
    return resolveShoplingCurrentModelIdentities([], []);
  }

  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const sourceRows: RawRow[] = [];
  for (const batch of batches(normalizedGoodsKeys)) {
    const xml = buildShoplingCurrentModelLookupXml(config, batch, PRODUCT_FIELDS);
    const response = await postShoplingXml(config.productsUrl, xml, {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-ops-center-shopling-current-model/1.0",
      },
      timeoutMs: 45_000,
    });
    if (!response.ok) {
      throw new Error(`SHOPLING_CURRENT_MODEL_HTTP_${response.status}`);
    }
    const body = await response.text();
    sourceRows.push(
      ...(parseShoplingReadResponse("products", body) as RawRow[]),
    );
  }

  return resolveShoplingCurrentModelIdentities(
    normalizedGoodsKeys,
    sourceRows,
  );
}
