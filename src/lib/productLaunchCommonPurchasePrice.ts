type UnknownRecord = Record<string, unknown>;

const CHANNEL_KEY_BY_LABEL: Record<string, string> = {
  도매1: "wholesale1",
  도매2: "wholesale2",
  도매3: "wholesale3",
  도매4: "wholesale4",
  소매1: "retail1",
  소매2: "retail2",
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function positiveInteger(value: unknown) {
  const number = Math.ceil(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function channelKey(row: UnknownRecord) {
  return (
    String(row.channel_key ?? row.channelKey ?? "").trim() ||
    CHANNEL_KEY_BY_LABEL[String(row.channel ?? row.channel_label ?? "").trim()] ||
    ""
  );
}

export function buildProductLaunchCommonPurchaseBasePrices(
  jobPayloadInput: unknown,
  resultRowsInput: unknown,
) {
  const jobPayload = record(jobPayloadInput);
  const channels = Array.isArray(jobPayload.channels)
    ? jobPayload.channels.map(record)
    : [];
  const rows = Array.isArray(resultRowsInput)
    ? resultRowsInput.map(record)
    : [];

  const commonPurchaseFromPayload = positiveInteger(
    jobPayload.commonPurchasePriceKrw,
  );
  const channelPurchasePrices = channels
    .map((channel) => positiveInteger(channel.orgPrice))
    .filter((value) => value > 0);
  const uniqueChannelPurchasePrices = [...new Set(channelPurchasePrices)];
  const commonPurchasePriceKrw =
    commonPurchaseFromPayload ||
    (uniqueChannelPurchasePrices.length === 1
      ? uniqueChannelPurchasePrices[0]
      : 0);

  if (commonPurchasePriceKrw <= 0) {
    throw new Error("상품등록 payload에서 기본 공통 원가를 확인하지 못했습니다.");
  }
  if (
    uniqueChannelPurchasePrices.length > 0 &&
    uniqueChannelPurchasePrices.some(
      (value) => value !== commonPurchasePriceKrw,
    )
  ) {
    throw new Error("6채널 상품등록 원가가 기본 공통 원가와 일치하지 않습니다.");
  }

  const channelMap = new Map(
    channels.map((channel) => [String(channel.key ?? "").trim(), channel] as const),
  );
  const basePrices: Record<
    string,
    { sell_price: number; purchase_price: number; consumer_price: number }
  > = {};

  for (const row of rows) {
    const succeeded =
      String(row.status ?? "") === "success" || String(row.code ?? "") === "000";
    if (!succeeded) continue;
    const goodsKey = String(row.goods_key ?? row.goodsKey ?? "").trim();
    const key = channelKey(row);
    if (!/^\d+$/.test(goodsKey) || !key) continue;
    const channel = channelMap.get(key);
    if (!channel) {
      throw new Error(`${key} 상품등록 기준가격을 찾지 못했습니다.`);
    }
    const sellPrice = positiveInteger(channel.salePrice);
    const consumerPrice = positiveInteger(channel.listPrice);
    if (sellPrice <= 0 || consumerPrice <= 0) {
      throw new Error(`${key} 판매가 또는 소비자가 기준값이 없습니다.`);
    }
    basePrices[goodsKey] = {
      sell_price: sellPrice,
      purchase_price: commonPurchasePriceKrw,
      consumer_price: consumerPrice,
    };
  }

  if (Object.keys(basePrices).length !== 6) {
    throw new Error("6채널 goods_key의 기준가격을 모두 만들지 못했습니다.");
  }

  return {
    commonPurchasePriceKrw,
    basePrices,
    basePricesJson: JSON.stringify(basePrices),
  };
}
