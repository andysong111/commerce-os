export const SHOPLING_CANONICAL_PRICE_POLICY_VERSION = "2026-08-03-v1";

export const SHOPLING_PRODUCT_GROUP_BY_CHANNEL = {
  도매1: "도매1",
  도매2: "도매2",
  도매3: "도매3",
  도매4: "도매4",
  소매1: "소매1",
  소매2: "소매2",
} as const;

const TRACKER_CHANNELS = [
  ["wholesale1", "도매1"],
  ["wholesale2", "도매2"],
  ["wholesale3", "도매3"],
  ["wholesale4", "도매4"],
  ["retail1", "소매1"],
  ["retail2", "소매2"],
] as const;

const PRODUCT_GROUP_BY_SUFFIX: Record<string, string> = {
  a: "도매1",
  b: "도매2",
  c: "도매3",
  d: "도매4",
  e: "소매1",
  f: "소매2",
};

export type ShoplingCanonicalPriceTargets = {
  goodsKeys: string[];
  groupMap: Record<string, string>;
  goodsKeyGroupJson: string;
  sourceRowCount: number;
  failedRowCount: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalized(value: unknown) {
  return text(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowSucceeded(row: Record<string, unknown>) {
  const code = normalized(row.code);
  const status = normalized(row.status);
  const success = row.success === true || normalized(row.success) === "true";
  const ok = row.ok === true || normalized(row.ok) === "true";
  return (
    success ||
    ok ||
    code === "000" ||
    code === "ok" ||
    status === "success" ||
    status === "succeeded"
  );
}

function inferProductGroup(row: Record<string, unknown>) {
  const channel = text(row.channel ?? row.channel_label ?? row.product_group);
  if (channel in SHOPLING_PRODUCT_GROUP_BY_CHANNEL) return channel;
  const ptnGoodsCd = text(row.ptn_goods_cd ?? row.ptnGoodsCd).toLowerCase();
  return PRODUCT_GROUP_BY_SUFFIX[ptnGoodsCd.slice(-1)] ?? "";
}

function buildTargets(
  rows: Array<Record<string, unknown>>,
): ShoplingCanonicalPriceTargets {
  const groupMap: Record<string, string> = {};
  const goodsKeys: string[] = [];
  let failedRowCount = 0;

  for (const row of rows) {
    const goodsKey = text(row.goods_key ?? row.goodsKey);
    if (!goodsKey || !/^\d+$/.test(goodsKey) || !rowSucceeded(row)) {
      failedRowCount += 1;
      continue;
    }
    const productGroup = inferProductGroup(row);
    if (!productGroup) {
      failedRowCount += 1;
      continue;
    }
    if (!(goodsKey in groupMap)) goodsKeys.push(goodsKey);
    groupMap[goodsKey] = productGroup;
  }

  return {
    goodsKeys,
    groupMap,
    goodsKeyGroupJson: JSON.stringify(groupMap),
    sourceRowCount: rows.length,
    failedRowCount,
  };
}

export function extractCanonicalPriceTargetsFromUploadResult(
  value: unknown,
): ShoplingCanonicalPriceTargets {
  const root = record(value);
  const summary = record(root.summary);
  const candidateRows = Array.isArray(summary.rows)
    ? summary.rows
    : Array.isArray(summary.goods_keys)
      ? summary.goods_keys
      : Array.isArray(root.rows)
        ? root.rows
        : [];
  return buildTargets(candidateRows.map(record));
}

export function extractCanonicalPriceTargetsFromTrackerItem(
  value: unknown,
): ShoplingCanonicalPriceTargets {
  const item = record(value);
  const products = record(item.shoplingProducts);
  const rows = TRACKER_CHANNELS.map(([key, label]) => {
    const product = record(products[key]);
    return {
      goods_key: product.goodsKey ?? product.goods_key,
      channel: label,
      status: product.status,
      success:
        normalized(product.status) === "success" ||
        normalized(product.status) === "succeeded",
      code: product.code,
      ptn_goods_cd: product.ptnGoodsCd ?? product.ptn_goods_cd,
    };
  });
  return buildTargets(rows);
}

export function isCanonicalPricePolicyResultSuccess(
  value: unknown,
  expectedGoodsKeyCount: number,
) {
  if (expectedGoodsKeyCount < 1) return false;
  const root = record(value);
  const summary = record(root.summary);
  if (normalized(summary.status ?? root.status) !== "success") return false;

  const failureFields = [
    "fail_count",
    "failed_count",
    "failure_count",
    "blocked_missing_base_price_count",
    "missing_price_count",
    "missing_mall_row_count",
    "mismatch_count",
    "visible_price_unrepaired_count",
    "product_level_price_failed_count",
  ];
  if (failureFields.some((key) => numeric(summary[key]) > 0)) return false;

  const goodsKeyCount = numeric(
    summary.goods_key_count ??
      summary.requested_count ??
      summary.planned_goods_key_count,
  );
  return goodsKeyCount >= expectedGoodsKeyCount;
}

export function canonicalPricePolicyResultMessage(value: unknown) {
  const root = record(value);
  const summary = record(root.summary);
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  const firstError = errors.length > 0 ? record(errors[0]) : {};
  return (
    text(root.message) ||
    text(firstError.error ?? firstError.msg ?? firstError.message) ||
    text(summary.status) ||
    "중앙 가격정책 결과를 확인하세요."
  );
}
