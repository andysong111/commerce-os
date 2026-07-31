export const PRODUCT_LAUNCH_SIMPLE_SESSION_KEY =
  "productLaunchFlow.simpleSession.v1";
export const PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY =
  "productLaunchFlow.trackerHandoff.v1";

export const HANDOFF_CHANNELS = [
  { key: "wholesale1", label: "도매1", suffix: "a" },
  { key: "wholesale2", label: "도매2", suffix: "b" },
  { key: "wholesale3", label: "도매3", suffix: "c" },
  { key: "wholesale4", label: "도매4", suffix: "d" },
  { key: "retail1", label: "소매1", suffix: "e" },
  { key: "retail2", label: "소매2", suffix: "f" },
];

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function readRegisteredChannels(item) {
  const source = record(item);
  const products = record(source.shoplingProducts);
  return HANDOFF_CHANNELS.map((channel) => {
    const product = record(products[channel.key]);
    return {
      ...channel,
      goodsKey: text(product.goodsKey),
      status: text(product.status || "not_started"),
      registeredAt: product.registeredAt ?? null,
      error: text(product.error),
    };
  });
}

export function hasCompleteShoplingRegistration(item) {
  const channels = readRegisteredChannels(item);
  return (
    channels.length === HANDOFF_CHANNELS.length &&
    channels.every(
      (channel) => channel.goodsKey && channel.status === "success",
    )
  );
}

export function buildProductLaunchFlowHandoff(item, now = new Date()) {
  if (!hasCompleteShoplingRegistration(item)) {
    throw new Error("샵플링 6채널 등록완료 상품만 이어갈 수 있습니다.");
  }

  const source = record(item);
  const itemId = text(source.id);
  const modelNumber = text(source.modelNumber);
  const productName = text(source.productName);
  const selfCodeBase = text(source.selfCodeBase);
  if (!itemId || !modelNumber || !productName || !selfCodeBase) {
    throw new Error("상품 ID·모델번호·모델명·자사상품코드를 확인하세요.");
  }

  const channels = readRegisteredChannels(source);
  const timestamp = now.toISOString();
  const rows = channels.map((channel, index) => ({
    row: String(index + 1),
    source_row: itemId,
    channel: channel.label,
    code: "000",
    success: true,
    ok: true,
    status: "success",
    goods_key: channel.goodsKey,
    ptn_goods_cd: `${selfCodeBase}${channel.suffix}`,
    title: `${productName} ${channel.label}`.trim(),
    product_name: `${productName} ${channel.label}`.trim(),
    registered_title: `${productName} ${channel.label}`.trim(),
  }));
  const titles = Object.fromEntries(
    rows.map((row) => [row.goods_key, row.registered_title]),
  );
  const goodsKeys = rows.map((row) => row.goods_key);

  return {
    session: {
      version: 1,
      rowExpression: `진행관리:${modelNumber}`,
      uploadRequestId: `tracker-upload-${itemId}`,
      uploadResult: {
        status: "success",
        phase: "artifact_ready",
        runConclusion: "success",
        message:
          "신규 상품 출시 진행관리의 등록완료 상품을 불러왔습니다.",
        summary: {
          status: "success",
          fail_count: 0,
          goods_key_count: goodsKeys.length,
          exit_code: 0,
          source: "product_launch_tracker",
        },
        rows,
        goodsKeys,
      },
      uploadPolls: 0,
      priceRequestId: `tracker-price-preserved-${itemId}`,
      priceResult: {
        status: "success",
        phase: "artifact_ready",
        runConclusion: "success",
        message:
          "신규 상품 출시 진행관리에서 확정한 기존 가격을 유지합니다.",
        summary: {
          status: "success",
          fail_count: 0,
          goods_key_count: goodsKeys.length,
          exit_code: 0,
          price_preserved: true,
          source: "product_launch_tracker",
        },
      },
      pricePolls: 0,
      recommendationRequestId: "",
      recommendationResult: null,
      recommendationPolls: 0,
      titles,
      searches: {},
      directRequestId: "",
      directResult: null,
      directPolls: 0,
      updatedAt: timestamp,
    },
    handoff: {
      version: 1,
      itemId,
      modelNumber,
      productName,
      goodsKeys,
      startedAt: timestamp,
      completedAt: null,
      status: "keyword_in_progress",
    },
  };
}
