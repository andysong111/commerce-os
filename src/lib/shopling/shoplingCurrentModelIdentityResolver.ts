export const SHOPLING_CURRENT_MODEL_LOOKUP_BATCH_SIZE = 50;
const GOODS_KEY = /^\d+$/;
const EXACT_AAA_MODEL = /^aaa\d{3,}(?:-\d+)?$/i;

export type ShoplingCurrentModelGoodsKeyState =
  | "EXACT_AAA"
  | "NON_AAA"
  | "BLANK"
  | "CONFLICT"
  | "MISSING";

export type ShoplingCurrentModelGoodsKeyRow = {
  goodsKey: string;
  state: ShoplingCurrentModelGoodsKeyState;
  modelNos: string[];
  modelNames: string[];
  productNames: string[];
  partnerGoodsCodes: string[];
  saleStatuses: string[];
  sourceRowCount: number;
};

export type ShoplingCurrentModelSnapshot = {
  generatedAt: string;
  state: "READY" | "PARTIAL" | "BLOCKED";
  queriedGoodsKeyCount: number;
  sourceRowCount: number;
  exactAaaCount: number;
  nonAaaCount: number;
  blankCount: number;
  conflictCount: number;
  missingCount: number;
  writesEnabled: false;
  rows: ShoplingCurrentModelGoodsKeyRow[];
};

type RawRow = Record<string, unknown>;
type LookupConfig = { loginId: string; companyId: string; authKey: string };

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function cdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

export function normalizeShoplingModelNo(value: unknown) {
  return text(value).toLowerCase();
}

export function isExactAaaModelNo(value: unknown) {
  return EXACT_AAA_MODEL.test(normalizeShoplingModelNo(value));
}

export function buildShoplingCurrentModelLookupXml(
  config: LookupConfig,
  goodsKeys: string[],
  productFields: string,
) {
  const normalized = [
    ...new Set(goodsKeys.map(text).filter((key) => GOODS_KEY.test(key))),
  ];
  if (
    !normalized.length ||
    normalized.length > SHOPLING_CURRENT_MODEL_LOOKUP_BATCH_SIZE
  ) {
    throw new Error("SHOPLING_CURRENT_MODEL_LOOKUP_BATCH_INVALID");
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<reqst><apiProdGather>",
    `<login_id>${cdata(config.loginId)}</login_id>`,
    `<company_id>${cdata(config.companyId)}</company_id>`,
    `<api_auth_key>${cdata(config.authKey)}</api_auth_key>`,
    `<prod_id>${cdata(normalized.join(","))}</prod_id>`,
    `<prod_fields>${cdata(productFields)}</prod_fields>`,
    "<opt_yn>N</opt_yn><attri_yn>N</attri_yn>",
    "</apiProdGather></reqst>",
  ].join("");
}

function unique(values: unknown[]) {
  return [
    ...new Set(values.map(text).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

export function resolveShoplingCurrentModelIdentities(
  goodsKeys: string[],
  sourceRows: RawRow[],
  generatedAt = new Date().toISOString(),
): ShoplingCurrentModelSnapshot {
  const queried = [
    ...new Set(goodsKeys.map(text).filter((key) => GOODS_KEY.test(key))),
  ].sort((left, right) => Number(left) - Number(right));

  const rows = queried.map((goodsKey): ShoplingCurrentModelGoodsKeyRow => {
    const candidates = sourceRows.filter(
      (row) => text(row.goods_key) === goodsKey,
    );
    if (!candidates.length) {
      return {
        goodsKey,
        state: "MISSING",
        modelNos: [],
        modelNames: [],
        productNames: [],
        partnerGoodsCodes: [],
        saleStatuses: [],
        sourceRowCount: 0,
      };
    }
    const modelNos = unique(candidates.map((row) => normalizeShoplingModelNo(row.model_no)));
    const state: ShoplingCurrentModelGoodsKeyState =
      modelNos.length > 1
        ? "CONFLICT"
        : modelNos.length === 0
          ? "BLANK"
          : isExactAaaModelNo(modelNos[0])
            ? "EXACT_AAA"
            : "NON_AAA";
    return {
      goodsKey,
      state,
      modelNos,
      modelNames: unique(candidates.map((row) => row.model_nm)),
      productNames: unique(candidates.map((row) => row.prod_nm)),
      partnerGoodsCodes: unique(candidates.map((row) => row.ptn_goods_cd)),
      saleStatuses: unique(candidates.map((row) => row.sale_status)),
      sourceRowCount: candidates.length,
    };
  });

  const exactAaaCount = rows.filter((row) => row.state === "EXACT_AAA").length;
  const nonAaaCount = rows.filter((row) => row.state === "NON_AAA").length;
  const blankCount = rows.filter((row) => row.state === "BLANK").length;
  const conflictCount = rows.filter((row) => row.state === "CONFLICT").length;
  const missingCount = rows.filter((row) => row.state === "MISSING").length;
  return {
    generatedAt,
    state:
      exactAaaCount === rows.length && rows.length > 0
        ? "READY"
        : exactAaaCount > 0
          ? "PARTIAL"
          : "BLOCKED",
    queriedGoodsKeyCount: queried.length,
    sourceRowCount: sourceRows.length,
    exactAaaCount,
    nonAaaCount,
    blankCount,
    conflictCount,
    missingCount,
    writesEnabled: false,
    rows,
  };
}
