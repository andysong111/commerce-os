type InputRow = {
  goods_key: string;
  adjustment_bps: number;
};

type PlanRow = {
  goods_key?: unknown;
  adjustment_bps?: unknown;
  current?: {
    sell_price?: unknown;
    option_amounts?: unknown;
    option_signature?: unknown;
  };
  target?: {
    sell_price?: unknown;
    option_amounts?: unknown;
  };
};

type PlanError = {
  goods_key?: unknown;
  error?: unknown;
};

export type RejectedPlanRow = {
  goods_key: string;
  adjustment_bps: number;
  error: string;
};

export type PartialExecutionPlan = {
  executionRows: Array<{
    goods_key: string;
    adjustment_bps: number;
    expected_current_sell_price: number;
    expected_option_signature: string;
    requires_option_write: boolean;
  }>;
  validInputs: InputRow[];
  rejectedRows: RejectedPlanRow[];
};

function parseInputs(value: unknown): InputRow[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error("chunk input rows must contain 1..50 rows");
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`chunk row ${index + 1} is invalid`);
    }
    const row = entry as Record<string, unknown>;
    const goodsKey = row.goods_key;
    const adjustmentBps = row.adjustment_bps;
    if (typeof goodsKey !== "string" || !/^\d+$/.test(goodsKey)) {
      throw new Error(`chunk row ${index + 1} goods_key is invalid`);
    }
    if (seen.has(goodsKey)) throw new Error(`duplicate goods_key in chunk: ${goodsKey}`);
    if (
      typeof adjustmentBps !== "number"
      || !Number.isInteger(adjustmentBps)
      || adjustmentBps < -9_999
      || adjustmentBps > 100_000
    ) {
      throw new Error(`chunk row ${index + 1} adjustment_bps is invalid`);
    }
    seen.add(goodsKey);
    return { goods_key: goodsKey, adjustment_bps: adjustmentBps };
  });
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  if (!value.every((item) => typeof item === "number" && Number.isSafeInteger(item))) {
    throw new Error("option amount array is invalid");
  }
  return value as number[];
}

function sameNumberArray(left: number[], right: number[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function buildPartialExecutionPlan(
  summaryValue: unknown,
  expectedInputsValue: unknown,
): PartialExecutionPlan {
  const summary = (summaryValue ?? {}) as Record<string, unknown>;
  if (!["success", "partial_failure"].includes(String(summary.status ?? ""))) {
    throw new Error(
      `read-only plan did not succeed: ${String(summary.status ?? "unknown")}`,
    );
  }

  const expectedInputs = parseInputs(expectedInputsValue);
  const expectedByKey = new Map(expectedInputs.map((row) => [row.goods_key, row]));
  const rows = Array.isArray(summary.rows) ? summary.rows as PlanRow[] : [];
  const errors = Array.isArray(summary.errors) ? summary.errors as PlanError[] : [];
  const rowByKey = new Map<string, PlanRow>();
  const errorByKey = new Map<string, string>();

  for (const row of rows) {
    const goodsKey = row.goods_key;
    if (typeof goodsKey !== "string" || !expectedByKey.has(goodsKey)) {
      throw new Error(`plan returned an unexpected goods_key: ${String(goodsKey ?? "")}`);
    }
    if (rowByKey.has(goodsKey)) throw new Error(`duplicate planned goods_key: ${goodsKey}`);
    rowByKey.set(goodsKey, row);
  }

  for (const error of errors) {
    const goodsKey = error.goods_key;
    if (typeof goodsKey !== "string" || !expectedByKey.has(goodsKey)) {
      throw new Error(`plan error returned an unexpected goods_key: ${String(goodsKey ?? "")}`);
    }
    if (rowByKey.has(goodsKey) || errorByKey.has(goodsKey)) {
      throw new Error(`duplicate plan result goods_key: ${goodsKey}`);
    }
    errorByKey.set(
      goodsKey,
      typeof error.error === "string" && error.error.trim()
        ? error.error.trim()
        : "Shopling current price or option data could not be planned",
    );
  }

  const executionRows: PartialExecutionPlan["executionRows"] = [];
  const validInputs: InputRow[] = [];
  const rejectedRows: RejectedPlanRow[] = [];

  expectedInputs.forEach((expected, index) => {
    const rejection = errorByKey.get(expected.goods_key);
    if (rejection) {
      rejectedRows.push({ ...expected, error: rejection });
      return;
    }

    const row = rowByKey.get(expected.goods_key);
    if (!row) throw new Error(`plan result missing goods_key ${expected.goods_key}`);
    if (row.adjustment_bps !== expected.adjustment_bps) {
      throw new Error(`plan rate mismatch for ${expected.goods_key}`);
    }
    const currentSell = row.current?.sell_price;
    const optionSignature = row.current?.option_signature;
    const targetSell = row.target?.sell_price;
    if (
      typeof currentSell !== "number"
      || !Number.isSafeInteger(currentSell)
      || currentSell <= 0
    ) {
      throw new Error(`plan current price missing for row ${index + 1}`);
    }
    if (
      typeof targetSell !== "number"
      || !Number.isSafeInteger(targetSell)
      || targetSell <= 0
    ) {
      throw new Error(`plan target price missing for row ${index + 1}`);
    }
    if (
      typeof optionSignature !== "string"
      || !/^[0-9a-f]{64}$/i.test(optionSignature)
    ) {
      throw new Error(`plan option signature missing for ${expected.goods_key}`);
    }
    const currentOptions = numberArray(row.current?.option_amounts);
    const targetOptions = numberArray(row.target?.option_amounts);
    validInputs.push(expected);
    executionRows.push({
      goods_key: expected.goods_key,
      adjustment_bps: expected.adjustment_bps,
      expected_current_sell_price: currentSell,
      expected_option_signature: optionSignature.toLowerCase(),
      requires_option_write: !sameNumberArray(currentOptions, targetOptions),
    });
  });

  if (executionRows.length === 0) {
    throw new Error("read-only plan rejected every row in the chunk");
  }
  if (summary.status === "success" && rejectedRows.length > 0) {
    throw new Error("successful plan unexpectedly contains rejected rows");
  }
  return { executionRows, validInputs, rejectedRows };
}
