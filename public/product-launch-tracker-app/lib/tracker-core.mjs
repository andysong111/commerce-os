export const STATUS_OPTIONS = ["미시작", "진행 중", "완료", "보류", "제외"];
export const STATUS_SORT_ORDER = ["미시작", "진행 중", "보류", "완료", "제외"];

export const STAGES = [
  { key: "detailPage", label: "상세페이지" },
  { key: "priceKeyword", label: "가격·키워드" },
  { key: "shoplingUpload", label: "샵플링 업로드" },
  { key: "marketRegistration", label: "마켓 등록" },
  { key: "orderMapping", label: "주문 매핑" },
  { key: "inventoryReflection", label: "재고 반영" },
];

export const SHOPLING_CHANNELS = [
  { key: "wholesale1", label: "도매1", suffix: "a", multiplierKey: "wholesale1" },
  { key: "wholesale2", label: "도매2", suffix: "b", multiplierKey: "wholesale2" },
  { key: "wholesale3", label: "도매3", suffix: "c", multiplierKey: "wholesale3" },
  { key: "wholesale4", label: "도매4", suffix: "d", multiplierKey: "wholesale4" },
  { key: "retail1", label: "소매1", suffix: "e", multiplierKey: "retail1" },
  { key: "retail2", label: "소매2", suffix: "f", multiplierKey: "retail2" },
];

export const GOODS_NOTICE_ATTRIBUTE_CODES = [
  "a023",
  "a140",
  "a144",
  "a005",
  "a145",
  "a002",
  "a009",
  "a126",
  "a147",
  "a148",
  "a149",
];

export const DEFAULT_SHIPPING_NOTICE_HTML =
  "<img src='https://gi.esmplus.com/andy80101/%EB%8F%84%EB%A7%A4%EC%9E%AC%EA%B3%A0%20%ED%95%98%EB%8B%A8%EA%B3%B5%EC%A7%80/%ED%95%98%EB%8B%A8%20%EA%B3%B5%EC%A7%801%EB%B2%88111.jpg' />";

export const DEFAULT_POLICY = Object.freeze({
  version: 1,
  channelMultipliers: {
    wholesale1: 1,
    wholesale2: 1.15,
    wholesale3: 1.1,
    wholesale4: 1.3,
    retail1: 1.3,
    retail2: 1.4,
  },
  listPriceMultiplier: 1.5,
  productType: "A",
  taxType: "A",
  saleStatus: "B",
  originName: "수입",
  originDetailName: "중국",
  makerName: "중국OEM",
  productWeight: 1,
  deliveryType: "C",
  deliveryCost: 3000,
  retail1BrandName: "동네일등",
  optionStatus: "B",
  optionQuantity: 999,
  optionVirtualQuantity: 999,
  goodsNoticeCode: "38",
  goodsNoticeValue: "상세설명 참고",
  shippingNoticeHtml: DEFAULT_SHIPPING_NOTICE_HTML,
});

export function normalizePolicy(policy = {}) {
  const candidate = policy && typeof policy === "object" ? policy : {};
  const multipliers = candidate.channelMultipliers ?? {};
  return {
    ...DEFAULT_POLICY,
    ...candidate,
    version: positiveInteger(candidate.version, DEFAULT_POLICY.version),
    channelMultipliers: Object.fromEntries(
      SHOPLING_CHANNELS.map(({ multiplierKey }) => [
        multiplierKey,
        positiveNumber(multipliers[multiplierKey], DEFAULT_POLICY.channelMultipliers[multiplierKey]),
      ]),
    ),
    listPriceMultiplier: positiveNumber(
      candidate.listPriceMultiplier,
      DEFAULT_POLICY.listPriceMultiplier,
    ),
    productWeight: positiveNumber(candidate.productWeight, DEFAULT_POLICY.productWeight),
    deliveryCost: nonNegativeInteger(candidate.deliveryCost, DEFAULT_POLICY.deliveryCost),
    optionQuantity: nonNegativeInteger(
      candidate.optionQuantity,
      DEFAULT_POLICY.optionQuantity,
    ),
    optionVirtualQuantity: nonNegativeInteger(
      candidate.optionVirtualQuantity,
      DEFAULT_POLICY.optionVirtualQuantity,
    ),
    goodsNoticeCode: String(candidate.goodsNoticeCode ?? DEFAULT_POLICY.goodsNoticeCode).trim() || "38",
    goodsNoticeValue:
      String(candidate.goodsNoticeValue ?? DEFAULT_POLICY.goodsNoticeValue).trim() ||
      DEFAULT_POLICY.goodsNoticeValue,
    shippingNoticeHtml:
      String(candidate.shippingNoticeHtml ?? DEFAULT_POLICY.shippingNoticeHtml).trim() ||
      DEFAULT_POLICY.shippingNoticeHtml,
  };
}

export function getProgress(item) {
  const completed = STAGES.filter(({ key }) =>
    ["완료", "제외"].includes(item.stages?.[key]?.status),
  ).length;
  return { completed, total: STAGES.length };
}

export function getOverallStatus(item) {
  if (item.archivedAt) return "보관됨";
  const statuses = STAGES.map(({ key }) => item.stages?.[key]?.status ?? "미시작");
  if (statuses.includes("보류")) return "보류";
  if (statuses.every((status) => ["완료", "제외"].includes(status))) return "완료";
  if (statuses.every((status) => status === "미시작")) return "미시작";
  return "진행 중";
}

export function getNextStage(item) {
  if (item.archivedAt) return "보관됨";
  const held = STAGES.find(({ key }) => item.stages?.[key]?.status === "보류");
  if (held) return `${held.label} 보류`;
  const next = STAGES.find(
    ({ key }) => !["완료", "제외"].includes(item.stages?.[key]?.status),
  );
  return next?.label ?? "출시 완료";
}

export function sortLaunchItems(items, sort = {}) {
  const direction = sort.direction === "desc" ? -1 : 1;
  const stage = STAGES.find(({ key }) => key === sort.key);
  const textGetter = {
    workBatch: (item) => item.workBatch,
    warehouseLocation: (item) => item.warehouseLocation,
    barcode: (item) => item.barcode,
    modelNumber: (item) => item.modelNumber,
    productName: (item) => item.productName,
    shoplingCategory: (item) => item.shoplingCategory,
    selfCodeBase: (item) => item.selfCodeBase,
    options: (item) => item.orderOptions?.map((option) => option.saleOption).join(", "),
    readiness: (item) => getShoplingReadiness(item).ready ? "준비완료" : "준비필요",
    notes: (item) => item.notes,
  }[sort.key];

  if (!stage && !textGetter && sort.key !== "nextStage") {
    return [...items].sort(defaultItemSort);
  }

  return [...items].sort((left, right) => {
    let compared = 0;
    if (stage) {
      compared = compareRank(
        statusSortRank(left.stages?.[stage.key]?.status),
        statusSortRank(right.stages?.[stage.key]?.status),
      );
    } else if (sort.key === "nextStage") {
      compared = compareRank(nextStageSortRank(left), nextStageSortRank(right));
    } else {
      compared = compareText(textGetter(left), textGetter(right), direction);
      return compared || defaultItemSort(left, right);
    }
    return compared ? compared * direction : defaultItemSort(left, right);
  });
}

export function normalizeModelNumber(value) {
  const match = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .match(/^AAA0*(\d+)$/);
  if (!match) return String(value ?? "").trim().toUpperCase();
  return `AAA${match[1].padStart(3, "0")}`;
}

export function normalizeBarcode(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeSelfCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 54);
}

export function normalizeOptions(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[,/\n]+/)
        .map((entry) => entry.trim());
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
}

export function normalizeOrderOptions(value, legacyOptions = []) {
  const input = Array.isArray(value) && value.length
    ? value
    : normalizeOptions(legacyOptions).map((saleOption, index) => ({
        id: `legacy-${index + 1}`,
        saleOption,
      }));

  return input
    .map((option, index) => {
      const candidate = option && typeof option === "object" ? option : { saleOption: option };
      return {
        id: String(candidate.id ?? `option-${index + 1}`),
        optionName: String(candidate.optionName ?? "옵션").trim() || "옵션",
        saleOption: String(candidate.saleOption ?? candidate.value ?? "").trim(),
        chinaOption: String(candidate.chinaOption ?? "").trim(),
        barcode: normalizeBarcode(candidate.barcode),
        baseSalePriceKrw: nonNegativeInteger(candidate.baseSalePriceKrw, 0),
        unitCostKrw: nonNegativeInteger(candidate.unitCostKrw, 0),
        sourceOrderItemId:
          candidate.sourceOrderItemId === null || candidate.sourceOrderItemId === undefined
            ? null
            : String(candidate.sourceOrderItemId),
      };
    })
    .filter((option) => option.saleOption || option.barcode || option.baseSalePriceKrw > 0);
}

export function hydrateLaunchItem(item) {
  const orderOptions = normalizeOrderOptions(item?.orderOptions, item?.options);
  return {
    ...item,
    workBatch: String(item?.workBatch ?? "").trim(),
    warehouseLocation: String(item?.warehouseLocation ?? "").trim(),
    barcode: normalizeBarcode(item?.barcode),
    modelNumber: normalizeModelNumber(item?.modelNumber),
    productName: String(item?.productName ?? "").trim(),
    shoplingCategory: String(item?.shoplingCategory ?? "").trim(),
    selfCodeBase: normalizeSelfCode(item?.selfCodeBase),
    options: orderOptions.map((option) => option.saleOption).filter(Boolean),
    orderOptions,
    chinaOrderLink: {
      status: item?.chinaOrderLink?.status ?? (orderOptions.length ? "linked" : "not_linked"),
      batchId: item?.chinaOrderLink?.batchId ?? null,
      syncedAt: item?.chinaOrderLink?.syncedAt ?? null,
      message: item?.chinaOrderLink?.message ?? "",
    },
    detailPageAsset: {
      status: item?.detailPageAsset?.status ?? "not_linked",
      resultId: item?.detailPageAsset?.resultId ?? "",
      html: item?.detailPageAsset?.html ?? "",
      detailImageUrl: item?.detailPageAsset?.detailImageUrl ?? "",
      mainImageUrl: item?.detailPageAsset?.mainImageUrl ?? "",
      additionalImageUrls: asStringArray(item?.detailPageAsset?.additionalImageUrls),
      syncedAt: item?.detailPageAsset?.syncedAt ?? null,
    },
    detailPageAutomation: {
      jobId: item?.detailPageAutomation?.jobId ?? "",
      status: item?.detailPageAutomation?.status ?? "idle",
      stage: item?.detailPageAutomation?.stage ?? "",
      message: item?.detailPageAutomation?.message ?? "",
      progress: Math.min(100, Math.max(0, Number(item?.detailPageAutomation?.progress) || 0)),
      qaStatus: item?.detailPageAutomation?.qaStatus ?? "pending",
      sourceUrl: item?.detailPageAutomation?.sourceUrl ?? "",
      attempt: Math.max(0, Number(item?.detailPageAutomation?.attempt) || 0),
      queuedAt: item?.detailPageAutomation?.queuedAt ?? null,
      startedAt: item?.detailPageAutomation?.startedAt ?? null,
      completedAt: item?.detailPageAutomation?.completedAt ?? null,
      error: item?.detailPageAutomation?.error ?? "",
    },
    shoplingProducts: normalizeShoplingProducts(item?.shoplingProducts, item?.goodsKey),
    stages: Object.fromEntries(
      STAGES.map(({ key }) => [
        key,
        {
          status: item?.stages?.[key]?.status ?? "미시작",
          assignee: item?.stages?.[key]?.assignee ?? "",
          completedAt: item?.stages?.[key]?.completedAt ?? null,
          note: item?.stages?.[key]?.note ?? "",
        },
      ]),
    ),
  };
}

export function createLaunchItem(input, idFactory = () => crypto.randomUUID()) {
  const now = new Date().toISOString();
  return hydrateLaunchItem({
    id: idFactory(),
    workBatch: input.workBatch?.trim() || "새 작업 묶음",
    warehouseLocation: input.warehouseLocation?.trim() || "",
    barcode: normalizeBarcode(input.barcode),
    modelNumber: normalizeModelNumber(input.modelNumber),
    productName: input.productName?.trim() || "",
    shoplingCategory: input.shoplingCategory?.trim() || "",
    selfCodeBase: normalizeSelfCode(input.selfCodeBase),
    options: normalizeOptions(input.options),
    orderOptions: input.orderOptions,
    notes: input.notes?.trim() || "",
    goodsKey: input.goodsKey?.trim() || "",
    source: {
      file: input.sourceFile ?? "직접 추가",
      sheet: input.sourceSheet ?? "",
      rows: input.sourceRows ?? [],
      sheetRowRefs: input.sheetRowRefs ?? [],
    },
    migrationReview: Boolean(input.migrationReview),
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: input.updatedBy ?? "승준",
    stages: input.stages,
    chinaOrderLink: input.chinaOrderLink,
    detailPageAsset: input.detailPageAsset,
    detailPageAutomation: input.detailPageAutomation,
    shoplingProducts: input.shoplingProducts,
  });
}

export function generateUniqueSelfCode(
  usedCodes,
  randomFactory = defaultRandomString,
  prefix = "PL",
) {
  const normalizedUsed = new Set(
    [...(usedCodes ?? [])].map(normalizeSelfCode).filter(Boolean),
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = normalizeSelfCode(`${prefix}${randomFactory(10)}`);
    if (candidate.length >= 8 && !normalizedUsed.has(candidate)) return candidate;
  }
  throw new Error("중복되지 않는 자사상품코드를 생성하지 못했습니다.");
}

export function assignMissingSelfCodes(items, randomFactory = defaultRandomString) {
  const used = new Set(items.map((item) => normalizeSelfCode(item.selfCodeBase)).filter(Boolean));
  let changed = false;
  const assigned = items.map((item) => {
    if (normalizeSelfCode(item.selfCodeBase)) return item;
    const selfCodeBase = generateUniqueSelfCode(used, randomFactory);
    used.add(selfCodeBase);
    changed = true;
    return { ...item, selfCodeBase };
  });
  return { items: assigned, changed };
}

export function getShoplingReadiness(item) {
  const hydrated = hydrateLaunchItem(item);
  const errors = [];
  const warnings = [];
  if (!hydrated.modelNumber) errors.push("모델번호가 없습니다.");
  if (!hydrated.productName) errors.push("모델명이 없습니다.");
  if (!hydrated.shoplingCategory) errors.push("샵플링 표준 카테고리를 정확하게 입력하세요.");
  if (!hydrated.selfCodeBase) errors.push("자사상품코드가 생성되지 않았습니다.");
  if (!hydrated.detailPageAsset.html.trim()) errors.push("상세페이지 HTML이 없습니다.");
  if (!hydrated.detailPageAsset.mainImageUrl.trim()) errors.push("대표이미지가 없습니다.");
  if (!hydrated.orderOptions.length) errors.push("발주·입고 옵션 데이터가 없습니다.");

  const seenBarcodes = new Set();
  hydrated.orderOptions.forEach((option, index) => {
    const label = option.saleOption || `${index + 1}번째 옵션`;
    if (!option.saleOption) errors.push(`${index + 1}번째 옵션값이 없습니다.`);
    if (!option.barcode) errors.push(`${label} 바코드가 없습니다.`);
    if (!(option.baseSalePriceKrw > 0)) errors.push(`${label} 기준 판매가가 없습니다.`);
    if (!(option.unitCostKrw > 0)) warnings.push(`${label} 원가가 없습니다.`);
    if (option.barcode) {
      if (seenBarcodes.has(option.barcode)) errors.push(`옵션 바코드 ${option.barcode}가 중복되었습니다.`);
      seenBarcodes.add(option.barcode);
    }
  });

  return { ready: errors.length === 0, errors: unique(errors), warnings: unique(warnings) };
}

export function buildShoplingPreview(item, policyInput = DEFAULT_POLICY) {
  const hydrated = hydrateLaunchItem(item);
  const policy = normalizePolicy(policyInput);
  const readiness = getShoplingReadiness(hydrated);
  const detailHtml = appendShippingNotice(hydrated.detailPageAsset.html, policy.shippingNoticeHtml);
  const goodsAttributes = Object.fromEntries(
    GOODS_NOTICE_ATTRIBUTE_CODES.map((code) => [code, policy.goodsNoticeValue]),
  );

  const channels = SHOPLING_CHANNELS.map((channel) => {
    const multiplier = policy.channelMultipliers[channel.multiplierKey];
    const optionPrices = hydrated.orderOptions.map((option) => ({
      ...option,
      finalSalePriceKrw: Math.ceil(option.baseSalePriceKrw * multiplier),
    }));
    const salePrice = optionPrices.length
      ? Math.min(...optionPrices.map((option) => option.finalSalePriceKrw))
      : 0;
    const positiveCosts = optionPrices.map((option) => option.unitCostKrw).filter((value) => value > 0);
    const orgPrice = positiveCosts.length ? Math.min(...positiveCosts) : 0;
    return {
      ...channel,
      multiplier,
      ptnGoodsCd: `${hydrated.selfCodeBase}${channel.suffix}`,
      productName: `${hydrated.productName} ${channel.label}`.trim(),
      productAbbreviation: hydrated.productName,
      brandName: channel.key === "retail1" ? policy.retail1BrandName : "",
      salePrice,
      orgPrice,
      listPrice: Math.ceil(salePrice * policy.listPriceMultiplier),
      options: optionPrices.map((option) => ({
        ...option,
        additionalAmountKrw: Math.max(0, option.finalSalePriceKrw - salePrice),
      })),
    };
  });

  return {
    ready: readiness.ready,
    errors: readiness.errors,
    warnings: readiness.warnings,
    modelNumber: hydrated.modelNumber,
    modelName: hydrated.productName,
    category: hydrated.shoplingCategory,
    selfCodeBase: hydrated.selfCodeBase,
    detailHtml,
    images: {
      img_0: hydrated.detailPageAsset.mainImageUrl,
      img_19: hydrated.detailPageAsset.mainImageUrl,
      additional: hydrated.detailPageAsset.additionalImageUrls.slice(0, 10),
    },
    fixedFields: {
      prod_tp: policy.productType,
      tax_tp: policy.taxType,
      sale_status: policy.saleStatus,
      origin_nm: policy.originName,
      origin_dtl_nm: policy.originDetailName,
      maker_nm: policy.makerName,
      prod_weight: policy.productWeight,
      dlvy_tp: policy.deliveryType,
      dlvy_cost: policy.deliveryCost,
    },
    goodsNotice: { code: policy.goodsNoticeCode, attributes: goodsAttributes },
    optionPolicy: {
      optStatus: policy.optionStatus,
      optQty: policy.optionQuantity,
      optVrtlQty: policy.optionVirtualQuantity,
    },
    channels,
  };
}

export function appendShippingNotice(detailHtml, shippingNoticeHtml) {
  const detail = String(detailHtml ?? "").trim();
  const notice = String(shippingNoticeHtml ?? "").trim();
  if (!notice) return detail;
  const url = notice.match(/https?:\/\/[^'"\s>]+/)?.[0];
  if (detail.includes(notice) || (url && detail.includes(url))) return detail;
  return [detail, notice].filter(Boolean).join("\n");
}

export function applyStageStatus(item, stageKey, status, updatedBy = "승준") {
  if (!STAGES.some(({ key }) => key === stageKey)) return item;
  if (!STATUS_OPTIONS.includes(status)) return item;
  const now = new Date().toISOString();
  const currentStage = item.stages?.[stageKey] ?? {};
  return {
    ...item,
    stages: {
      ...item.stages,
      [stageKey]: {
        ...currentStage,
        status,
        completedAt: status === "완료" ? currentStage.completedAt ?? now : null,
      },
    },
    updatedAt: now,
    updatedBy,
  };
}

export function parsePastedRows(text) {
  const rows = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t").map((value) => value.trim()));
  if (!rows.length) return [];

  const normalizedHeaders = rows[0].map(normalizeHeader);
  const hasHeader = normalizedHeaders.some((value) =>
    ["모델번호", "상품명", "모델명", "바코드", "샵플링표준카테고리"].includes(value),
  );
  const body = hasHeader ? rows.slice(1) : rows;
  const headerIndexes = hasHeader
    ? Object.fromEntries(
        Object.entries(PASTE_HEADER_ALIASES).map(([key, aliases]) => [
          key,
          normalizedHeaders.findIndex((header) => aliases.includes(header)),
        ]),
      )
    : null;

  return body
    .filter((row) => row.some(Boolean))
    .map((row) => {
      if (headerIndexes) {
        return Object.fromEntries(
          Object.keys(PASTE_HEADER_ALIASES).map((key) => [
            key,
            headerIndexes[key] >= 0 ? row[headerIndexes[key]] ?? "" : "",
          ]),
        );
      }
      const hasCategoryColumn = row.length >= 8;
      const hasBarcodeColumn = row.length >= 7;
      return {
        workBatch: row[0] ?? "",
        warehouseLocation: row[1] ?? "",
        barcode: hasBarcodeColumn ? row[2] ?? "" : "",
        modelNumber: row[hasBarcodeColumn ? 3 : 2] ?? "",
        productName: row[hasBarcodeColumn ? 4 : 3] ?? "",
        shoplingCategory: hasCategoryColumn ? row[5] ?? "" : "",
        options: row[hasCategoryColumn ? 6 : hasBarcodeColumn ? 5 : 4] ?? "",
        notes: row[hasCategoryColumn ? 7 : hasBarcodeColumn ? 6 : 5] ?? "",
      };
    })
    .filter((row) => row.modelNumber || row.productName);
}

export function toCsv(items) {
  const header = [
    "작업 묶음",
    "창고위치",
    "기준 바코드",
    "모델번호",
    "모델명",
    "샵플링 표준 카테고리",
    "자사상품 기본코드",
    "옵션",
    "등록 준비",
    ...STAGES.map(({ label }) => label),
    "다음 작업",
    "비고",
    "수정자",
    "수정시간",
  ];
  const rows = items.map((rawItem) => {
    const item = hydrateLaunchItem(rawItem);
    return [
      item.workBatch,
      item.warehouseLocation,
      item.barcode,
      item.modelNumber,
      item.productName,
      item.shoplingCategory,
      item.selfCodeBase,
      item.orderOptions.map((option) => option.saleOption).join(", "),
      getShoplingReadiness(item).ready ? "준비완료" : "준비필요",
      ...STAGES.map(({ key }) => item.stages[key].status),
      getNextStage(item),
      item.notes,
      item.updatedBy,
      item.updatedAt,
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function normalizeShoplingProducts(value, legacyGoodsKey = "") {
  const source = value && typeof value === "object" ? value : {};
  const result = Object.fromEntries(
    SHOPLING_CHANNELS.map((channel) => [
      channel.key,
      {
        goodsKey: String(source[channel.key]?.goodsKey ?? "").trim(),
        status: source[channel.key]?.status ?? "not_started",
        error: String(source[channel.key]?.error ?? ""),
        registeredAt: source[channel.key]?.registeredAt ?? null,
      },
    ]),
  );
  if (legacyGoodsKey && !result.wholesale1.goodsKey) result.wholesale1.goodsKey = String(legacyGoodsKey).trim();
  return result;
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function defaultRandomString(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Math.ceil(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function unique(values) {
  return [...new Set(values)];
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

const PASTE_HEADER_ALIASES = {
  workBatch: ["작업묶음", "작업그룹"],
  warehouseLocation: ["창고위치", "창고위치코드", "위치코드"],
  barcode: ["바코드", "기준바코드", "옵션바코드"],
  modelNumber: ["모델번호"],
  productName: ["상품명", "제품명", "모델명"],
  shoplingCategory: ["샵플링표준카테고리", "샵플링카테고리", "표준카테고리"],
  options: ["옵션", "옵션구성", "옵션명"],
  notes: ["비고", "메모", "보류사유"],
};

function normalizeHeader(value) {
  return String(value ?? "").replace(/\s+/g, "");
}

function statusSortRank(status) {
  const rank = STATUS_SORT_ORDER.indexOf(status ?? "미시작");
  return rank === -1 ? STATUS_SORT_ORDER.length : rank;
}

function nextStageSortRank(item) {
  if (item.archivedAt) return STAGES.length + 1;
  const next = getNextStage(item);
  const stageIndex = STAGES.findIndex(({ label }) => next.startsWith(label));
  return stageIndex === -1 ? STAGES.length : stageIndex;
}

function compareRank(left, right) {
  return left - right;
}

function compareText(left, right, direction) {
  const leftText = String(left ?? "").trim();
  const rightText = String(right ?? "").trim();
  if (!leftText && !rightText) return 0;
  if (!leftText) return 1;
  if (!rightText) return -1;
  return leftText.localeCompare(rightText, "ko-KR", { numeric: true, sensitivity: "base" }) * direction;
}

function defaultItemSort(left, right) {
  const updated = String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
  if (updated) return updated;
  return (right.source?.rows?.[0] ?? 0) - (left.source?.rows?.[0] ?? 0);
}
