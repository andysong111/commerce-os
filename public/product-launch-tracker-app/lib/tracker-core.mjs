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
    options: (item) => item.options?.join(", "),
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

export function hydrateLaunchItem(item) {
  return {
    ...item,
    barcode: normalizeBarcode(item?.barcode),
    options: normalizeOptions(item?.options),
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
  return {
    id: idFactory(),
    workBatch: input.workBatch?.trim() || "새 작업 묶음",
    warehouseLocation: input.warehouseLocation?.trim() || "",
    barcode: normalizeBarcode(input.barcode),
    modelNumber: normalizeModelNumber(input.modelNumber),
    productName: input.productName?.trim() || "",
    options: normalizeOptions(input.options),
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
    stages: Object.fromEntries(
      STAGES.map(({ key }) => [
        key,
        {
          status: input.stages?.[key]?.status ?? "미시작",
          assignee: input.stages?.[key]?.assignee ?? "",
          completedAt: input.stages?.[key]?.completedAt ?? null,
          note: input.stages?.[key]?.note ?? "",
        },
      ]),
    ),
  };
}

export function normalizeOptions(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[,/\n]+/)
        .map((entry) => entry.trim());
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
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
        completedAt:
          status === "완료" ? currentStage.completedAt ?? now : null,
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
    ["모델번호", "상품명", "모델명", "바코드"].includes(value),
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
      const hasBarcodeColumn = row.length >= 7;
      return {
        workBatch: row[0] ?? "",
        warehouseLocation: row[1] ?? "",
        barcode: hasBarcodeColumn ? row[2] ?? "" : "",
        modelNumber: row[hasBarcodeColumn ? 3 : 2] ?? "",
        productName: row[hasBarcodeColumn ? 4 : 3] ?? "",
        options: row[hasBarcodeColumn ? 5 : 4] ?? "",
        notes: row[hasBarcodeColumn ? 6 : 5] ?? "",
      };
    })
    .filter((row) => row.modelNumber || row.productName);
}

export function toCsv(items) {
  const header = [
    "작업 묶음",
    "창고위치",
    "바코드",
    "모델번호",
    "상품명",
    "옵션",
    ...STAGES.map(({ label }) => label),
    "다음 작업",
    "비고",
    "수정자",
    "수정시간",
  ];
  const rows = items.map((item) => [
    item.workBatch,
    item.warehouseLocation,
    item.barcode,
    item.modelNumber,
    item.productName,
    item.options.join(", "),
    ...STAGES.map(({ key }) => item.stages[key].status),
    getNextStage(item),
    item.notes,
    item.updatedBy,
    item.updatedAt,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

const PASTE_HEADER_ALIASES = {
  workBatch: ["작업묶음", "작업그룹"],
  warehouseLocation: ["창고위치", "창고위치코드", "위치코드"],
  barcode: ["바코드", "옵션바코드"],
  modelNumber: ["모델번호", "모델명"],
  productName: ["상품명", "제품명"],
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
  return (
    leftText.localeCompare(rightText, "ko-KR", {
      numeric: true,
      sensitivity: "base",
    }) * direction
  );
}

function defaultItemSort(left, right) {
  const updated = String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
  if (updated) return updated;
  return (right.source?.rows?.[0] ?? 0) - (left.source?.rows?.[0] ?? 0);
}
