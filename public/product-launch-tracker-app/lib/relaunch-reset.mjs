import {
  generateUniqueSelfCode,
  SHOPLING_CHANNELS,
  STAGES,
} from "./tracker-core.mjs";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getRegisteredShoplingProducts(item) {
  const products = record(record(item).shoplingProducts);
  return SHOPLING_CHANNELS.map((channel) => {
    const product = record(products[channel.key]);
    return {
      key: channel.key,
      label: channel.label,
      goodsKey: text(product.goodsKey),
      status: text(product.status || "not_started"),
      error: text(product.error),
      registeredAt: product.registeredAt ?? null,
    };
  });
}

export function canResetForRelaunch(item) {
  return getRegisteredShoplingProducts(item).some(
    (product) => product.goodsKey || product.status === "success",
  );
}

export function resetLaunchItemForRelaunch(
  item,
  allItems = [],
  {
    now = new Date(),
    resetBy = "승준",
    reason = "샵플링 상품 수동 삭제 후 재출시",
    randomFactory,
  } = {},
) {
  const source = record(item);
  const itemId = text(source.id);
  if (!itemId) throw new Error("재출시 초기화할 상품 ID가 없습니다.");
  if (!canResetForRelaunch(source)) {
    throw new Error("등록된 goods_key가 없어 재출시 초기화할 수 없습니다.");
  }

  const usedCodes = new Set(
    (Array.isArray(allItems) ? allItems : [])
      .filter((candidate) => text(record(candidate).id) !== itemId)
      .map((candidate) => text(record(candidate).selfCodeBase))
      .filter(Boolean),
  );
  const nextSelfCodeBase = randomFactory
    ? generateUniqueSelfCode(usedCodes, randomFactory)
    : generateUniqueSelfCode(usedCodes);
  const resetAt = now.toISOString();
  const registeredProducts = getRegisteredShoplingProducts(source);
  const previousHistory = Array.isArray(source.registrationResetHistory)
    ? source.registrationResetHistory
    : [];

  const historyEntry = {
    resetAt,
    resetBy,
    reason,
    previousSelfCodeBase: text(source.selfCodeBase),
    previousProducts: Object.fromEntries(
      registeredProducts.map((product) => [
        product.key,
        {
          label: product.label,
          goodsKey: product.goodsKey,
          status: product.status,
          error: product.error,
          registeredAt: product.registeredAt,
        },
      ]),
    ),
    previousStages: clone(record(source.stages)),
  };

  return {
    ...source,
    selfCodeBase: nextSelfCodeBase,
    goodsKey: "",
    shoplingProducts: Object.fromEntries(
      SHOPLING_CHANNELS.map((channel) => [
        channel.key,
        {
          goodsKey: "",
          status: "not_started",
          error: "",
          registeredAt: null,
        },
      ]),
    ),
    stages: Object.fromEntries(
      STAGES.map((stage) => [
        stage.key,
        {
          ...record(record(source.stages)[stage.key]),
          status: "미시작",
          completedAt: null,
          note: "",
        },
      ]),
    ),
    registrationResetHistory: [...previousHistory, historyEntry].slice(-20),
    updatedAt: resetAt,
    updatedBy: resetBy,
  };
}
