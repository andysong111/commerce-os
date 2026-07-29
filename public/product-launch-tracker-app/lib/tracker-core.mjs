export const STATUS_OPTIONS = ["미시작", "진행 중", "완료", "보류", "제외"];

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

export function normalizeModelNumber(value) {
  const match = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .match(/^AAA0*(\d+)$/);
  if (!match) return String(value ?? "").trim().toUpperCase();
  return `AAA${match[1].padStart(3, "0")}`;
}

export function createLaunchItem(input, idFactory = () => crypto.randomUUID()) {
  const now = new Date().toISOString();
  return {
    id: idFactory(),
    workBatch: input.workBatch?.trim() || "새 작업 묶음",
    warehouseLocation: input.warehouseLocation?.trim() || "",
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

  const first = rows[0].map((value) => value.replace(/\s+/g, ""));
  const hasHeader =
    first.includes("모델번호") ||
    first.includes("상품명") ||
    first.includes("모델명");
  const body = hasHeader ? rows.slice(1) : rows;

  return body
    .filter((row) => row.some(Boolean))
    .map((row) => ({
      workBatch: row[0] ?? "",
      warehouseLocation: row[1] ?? "",
      modelNumber: row[2] ?? "",
      productName: row[3] ?? "",
      options: row[4] ?? "",
      notes: row[5] ?? "",
    }))
    .filter((row) => row.modelNumber || row.productName);
}

export function toCsv(items) {
  const header = [
    "작업 묶음",
    "창고위치",
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
