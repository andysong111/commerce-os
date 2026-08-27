import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
} from "@/lib/shopling/shoplingReadClient";

type UnknownRecord = Record<string, unknown>;

type UploadStatus = "success" | "partial_failure" | "failed";

export type ProductLaunchShoplingReadbackResult = {
  status: UploadStatus;
  rows: UnknownRecord[];
  errorMessage: string;
  verification: {
    required: boolean;
    verified: boolean;
    expectedCount: number;
    verifiedCount: number;
    missingCount: number;
    missingIdentifiers: string[];
    attempts: number;
    checkedAt: string;
    rangeStart: string;
    rangeEnd: string;
    error: string;
  };
};

const RETRY_DELAYS_MS = [0, 2_500, 6_000] as const;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function key(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function reportedSuccess(row: UnknownRecord) {
  return text(row.status) === "success" || text(row.code) === "000";
}

function liveGoodsKey(row: UnknownRecord) {
  return text(row.goods_key ?? row.goodsKey);
}

function livePartnerCode(row: UnknownRecord) {
  return key(row.ptn_goods_cd ?? row.ptnGoodsCd);
}

function uploadIdentifier(row: UnknownRecord) {
  return (
    text(row.goods_key ?? row.goodsKey) ||
    text(row.ptn_goods_cd ?? row.ptnGoodsCd) ||
    text(row.channel ?? row.channel_key ?? row.channelKey) ||
    "unknown"
  );
}

export function reconcileProductLaunchShoplingReadback(
  uploadRowsInput: UnknownRecord[],
  liveRowsInput: UnknownRecord[],
) {
  const uploadRows = uploadRowsInput.map(record);
  const liveRows = liveRowsInput.map(record);
  const byGoodsKey = new Map<string, UnknownRecord>();
  const byPartnerCode = new Map<string, UnknownRecord>();

  for (const row of liveRows) {
    const goodsKey = liveGoodsKey(row);
    const partnerCode = livePartnerCode(row);
    if (goodsKey && !byGoodsKey.has(goodsKey)) byGoodsKey.set(goodsKey, row);
    if (partnerCode && !byPartnerCode.has(partnerCode)) {
      byPartnerCode.set(partnerCode, row);
    }
  }

  let expectedCount = 0;
  let verifiedCount = 0;
  const missingIdentifiers: string[] = [];
  const rows = uploadRows.map((row) => {
    if (!reportedSuccess(row)) return row;
    expectedCount += 1;

    const expectedGoodsKey = text(row.goods_key ?? row.goodsKey);
    const expectedPartnerCode = key(row.ptn_goods_cd ?? row.ptnGoodsCd);
    const matched =
      (expectedGoodsKey ? byGoodsKey.get(expectedGoodsKey) : undefined) ??
      (expectedPartnerCode ? byPartnerCode.get(expectedPartnerCode) : undefined);

    if (!matched) {
      const identifier = uploadIdentifier(row);
      missingIdentifiers.push(identifier);
      return {
        ...row,
        goods_key: "",
        goodsKey: "",
        status: "failed",
        code: "SHOPLING_READBACK_NOT_FOUND",
        message: `Shopling 실재 상품 재조회에서 확인되지 않음: ${identifier}`,
        readback_verified: false,
      };
    }

    verifiedCount += 1;
    const actualGoodsKey = liveGoodsKey(matched) || expectedGoodsKey;
    return {
      ...row,
      goods_key: actualGoodsKey,
      goodsKey: actualGoodsKey,
      status: "success",
      code: "000",
      readback_verified: true,
      readback_ptn_goods_cd:
        text(matched.ptn_goods_cd ?? matched.ptnGoodsCd) ||
        text(row.ptn_goods_cd ?? row.ptnGoodsCd),
    };
  });

  const failedCount = rows.filter((row) => !reportedSuccess(row)).length;
  const status: UploadStatus =
    failedCount === 0 && expectedCount > 0 && verifiedCount === expectedCount
      ? "success"
      : verifiedCount > 0
        ? "partial_failure"
        : "failed";

  return {
    status,
    rows,
    expectedCount,
    verifiedCount,
    missingIdentifiers,
  };
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

function koreaDate(value: Date) {
  return new Date(value.getTime() + 9 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

function shiftDate(dateOnly: string, days: number) {
  const base = new Date(`${dateOnly}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function rangeFor(completedAt: string) {
  const parsed = new Date(completedAt);
  const anchor = Number.isFinite(parsed.valueOf()) ? parsed : new Date();
  const completedDate = koreaDate(anchor);
  const today = koreaDate(new Date());
  return {
    start: shiftDate(completedDate < today ? completedDate : today, -1),
    end: completedDate > today ? completedDate : today,
  };
}

function failedReadbackRows(rows: UnknownRecord[], message: string) {
  return rows.map((row) =>
    reportedSuccess(row)
      ? {
          ...row,
          goods_key: "",
          goodsKey: "",
          status: "failed",
          code: "SHOPLING_READBACK_UNAVAILABLE",
          message,
          readback_verified: false,
        }
      : row,
  );
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function verifyProductLaunchShoplingReadback(input: {
  reportedStatus: UploadStatus;
  rows: UnknownRecord[];
  completedAt: string;
}): Promise<ProductLaunchShoplingReadbackResult> {
  const checkedAt = new Date().toISOString();
  const range = rangeFor(input.completedAt);
  const expectedCount = input.rows.filter(reportedSuccess).length;

  if (input.reportedStatus === "failed" || expectedCount === 0) {
    return {
      status: input.reportedStatus,
      rows: input.rows.map(record),
      errorMessage: "",
      verification: {
        required: false,
        verified: false,
        expectedCount,
        verifiedCount: 0,
        missingCount: 0,
        missingIdentifiers: [],
        attempts: 0,
        checkedAt,
        rangeStart: range.start,
        rangeEnd: range.end,
        error: "",
      },
    };
  }

  let attempts = 0;
  let lastError = "";
  let lastResult = reconcileProductLaunchShoplingReadback(input.rows, []);

  try {
    const config = shoplingReadConfigFromEnv(shoplingEnvironment());
    const client = new ShoplingReadClient(config);
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await wait(delay);
      attempts += 1;
      try {
        const liveRows = await client.read("products", range);
        lastResult = reconcileProductLaunchShoplingReadback(input.rows, liveRows);
        lastError = "";
        if (
          lastResult.expectedCount > 0 &&
          lastResult.verifiedCount === lastResult.expectedCount
        ) {
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error ?? "");
      }
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error ?? "");
  }

  if (lastError && lastResult.verifiedCount === 0) {
    const message = `Shopling 실재 상품 재조회 실패: ${lastError}`.slice(0, 1000);
    const rows = failedReadbackRows(input.rows.map(record), message);
    const missingIdentifiers = input.rows
      .filter(reportedSuccess)
      .map(uploadIdentifier);
    return {
      status: "failed",
      rows,
      errorMessage: message,
      verification: {
        required: true,
        verified: false,
        expectedCount,
        verifiedCount: 0,
        missingCount: expectedCount,
        missingIdentifiers,
        attempts,
        checkedAt,
        rangeStart: range.start,
        rangeEnd: range.end,
        error: lastError,
      },
    };
  }

  const missingCount = Math.max(
    0,
    lastResult.expectedCount - lastResult.verifiedCount,
  );
  const errorMessage = missingCount
    ? `Shopling 실재 상품 재조회에서 ${lastResult.expectedCount}개 중 ${lastResult.verifiedCount}개만 확인되었습니다. 미확인: ${lastResult.missingIdentifiers.join(", ")}`.slice(0, 1500)
    : "";

  return {
    status: lastResult.status,
    rows: lastResult.rows,
    errorMessage,
    verification: {
      required: true,
      verified:
        lastResult.expectedCount > 0 &&
        lastResult.verifiedCount === lastResult.expectedCount,
      expectedCount: lastResult.expectedCount,
      verifiedCount: lastResult.verifiedCount,
      missingCount,
      missingIdentifiers: lastResult.missingIdentifiers,
      attempts,
      checkedAt,
      rangeStart: range.start,
      rangeEnd: range.end,
      error: lastError,
    },
  };
}
