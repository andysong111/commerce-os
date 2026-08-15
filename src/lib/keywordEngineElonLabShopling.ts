import {
  parseShoplingReadResponse,
  shoplingReadConfigFromEnv,
} from "@/lib/shopling/shoplingReadClient";
import { buildShoplingCurrentModelLookupXml } from "@/lib/shopling/shoplingCurrentModelIdentityResolver";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";

const PRODUCT_FIELDS = [
  "goods_key",
  "ptn_goods_cd",
  "prod_nm",
  "model_no",
  "model_nm",
  "site_srch",
  "sale_status",
  "dtl_desc",
].join(",");

type RawRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function previewDetail(value: unknown) {
  const raw = text(value);
  const plain = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return {
    rawLength: raw.length,
    textLength: plain.length,
    preview: plain.slice(0, 800),
  };
}

function env() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

export type KeywordEngineElonLabShoplingContext = {
  goodsKey: string;
  found: boolean;
  sourceRowCount: number;
  productName: string;
  modelNo: string;
  modelName: string;
  partnerGoodsCode: string;
  currentSiteSearch: string;
  saleStatus: string;
  detailDescriptionRawLength: number;
  detailDescriptionTextLength: number;
  detailDescriptionPreview: string;
  currentEngineSeed: string;
  currentEngineSeedSource: "prod_nm" | "model_nm" | "goods_key";
};

export async function loadKeywordEngineElonLabShoplingContexts(goodsKeys: string[]) {
  const normalized = [...new Set(goodsKeys.map(text).filter((value) => /^\d+$/.test(value)))];
  if (!normalized.length) return [];

  const config = shoplingReadConfigFromEnv(env());
  const xml = buildShoplingCurrentModelLookupXml(config, normalized, PRODUCT_FIELDS);
  const response = await postShoplingXml(config.productsUrl, xml, {
    headers: {
      accept: "application/xml, text/xml",
      "content-type": "application/xml; charset=utf-8",
      "user-agent": "commerce-os-keyword-elon-lab/1.0",
    },
    timeoutMs: 45_000,
  });
  if (!response.ok) {
    throw new Error(`KEYWORD_ELON_LAB_SHOPLING_HTTP_${response.status}`);
  }
  const body = await response.text();
  const sourceRows = parseShoplingReadResponse("products", body) as RawRow[];

  return normalized.map((goodsKey): KeywordEngineElonLabShoplingContext => {
    const rows = sourceRows.filter((row) => text(row.goods_key) === goodsKey);
    const first = rows[0] ?? {};
    const productName = text(first.prod_nm);
    const modelName = text(first.model_nm);
    const detail = previewDetail(first.dtl_desc);
    const currentEngineSeed = productName || modelName || goodsKey;
    const currentEngineSeedSource: KeywordEngineElonLabShoplingContext["currentEngineSeedSource"] = productName
      ? "prod_nm"
      : modelName
        ? "model_nm"
        : "goods_key";
    return {
      goodsKey,
      found: rows.length > 0,
      sourceRowCount: rows.length,
      productName,
      modelNo: text(first.model_no),
      modelName,
      partnerGoodsCode: text(first.ptn_goods_cd),
      currentSiteSearch: text(first.site_srch),
      saleStatus: text(first.sale_status),
      detailDescriptionRawLength: detail.rawLength,
      detailDescriptionTextLength: detail.textLength,
      detailDescriptionPreview: detail.preview,
      currentEngineSeed,
      currentEngineSeedSource,
    };
  });
}
