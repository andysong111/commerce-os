import { randomUUID } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

const SHOPLING_CHANNEL_KEYS = [
  "wholesale1",
  "wholesale2",
  "wholesale3",
  "wholesale4",
  "retail1",
  "retail2",
] as const;

const DUPLICATE_SELF_CODE_PATTERN = /자사상품코드\s*중복/;

export function needsShoplingSelfCodeRotation(itemInput: unknown) {
  const item = asRecord(itemInput);
  const products = asRecord(item.shoplingProducts);
  return SHOPLING_CHANNEL_KEYS.every((key) => {
    const product = asRecord(products[key]);
    return (
      text(product.status) === "failed" &&
      !text(product.goodsKey) &&
      DUPLICATE_SELF_CODE_PATTERN.test(text(product.error))
    );
  });
}

export function generateShoplingRetrySelfCode(
  usedCodesInput: unknown[],
  randomFactory: () => string = () => randomUUID().replace(/-/g, "").slice(0, 10),
) {
  const usedCodes = new Set(usedCodesInput.map(normalizeSelfCode).filter(Boolean));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = normalizeSelfCode(`PL${randomFactory().slice(0, 10)}`);
    if (candidate.length >= 8 && !usedCodes.has(candidate)) return candidate;
  }
  throw new Error("샵플링 재등록용 새 자사상품코드를 생성하지 못했습니다.");
}

export function rotateShoplingSelfCodeForRetry(input: {
  item: unknown;
  allItems: unknown[];
  now?: string;
  randomFactory?: () => string;
}) {
  const item = asRecord(input.item);
  const previousSelfCodeBase = normalizeSelfCode(item.selfCodeBase);
  const usedCodes = input.allItems.map((value) => asRecord(value).selfCodeBase);
  const selfCodeBase = generateShoplingRetrySelfCode(
    usedCodes,
    input.randomFactory,
  );
  const rotatedAt = input.now ?? new Date().toISOString();
  return {
    previousSelfCodeBase,
    selfCodeBase,
    item: {
      ...item,
      selfCodeBase,
      shoplingSelfCodeRetry: {
        previousSelfCodeBase,
        selfCodeBase,
        reason: "SHOPLING_SELF_CODE_DUPLICATE",
        rotatedAt,
      },
      updatedAt: rotatedAt,
      updatedBy: "샵플링 자사상품코드 자동교체",
    },
  };
}

function normalizeSelfCode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 54);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}
