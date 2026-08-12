import {
  buildProductLaunchTrackerIndex,
  PRODUCT_LAUNCH_DEFAULT_PAGE_SIZE,
  PRODUCT_LAUNCH_MAX_PAGE_SIZE,
  type ProductLaunchTrackerPageQuery,
  type ProductLaunchTrackerState,
  type ProductLaunchTrackerSummary,
} from "@/lib/productLaunchTrackerOptimized";

export const PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD =
  "productLaunchListSnapshot" as const;
export const PRODUCT_LAUNCH_LIST_SNAPSHOT_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

export type ProductLaunchTrackerListSnapshot = {
  version: number;
  generatedAt: string;
  sourceSavedAt: string | null;
  sourceImportedAt: unknown;
  policy: unknown;
  itemCount: number;
  summaries: ProductLaunchTrackerSummary[];
};

export type ProductLaunchTrackerListIndex = {
  snapshot: ProductLaunchTrackerListSnapshot;
  summaries: ProductLaunchTrackerSummary[];
  summariesById: Map<string, ProductLaunchTrackerSummary>;
  byBatch: Map<string, Set<string>>;
  byAssignee: Map<string, Set<string>>;
  byOverall: Map<string, Set<string>>;
  unfinishedIds: Set<string>;
  counts: Record<string, number>;
  filterOptions: { batches: string[]; assignees: string[] };
};

export function buildProductLaunchListSnapshot(
  stateInput: ProductLaunchTrackerState | null | undefined,
): ProductLaunchTrackerListSnapshot {
  const state = isRecord(stateInput) ? stateInput : {};
  const index = buildProductLaunchTrackerIndex(state);
  return {
    version: PRODUCT_LAUNCH_LIST_SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    sourceSavedAt: nullableText(state.savedAt),
    sourceImportedAt: state.sourceImportedAt ?? null,
    policy: state.policy ?? null,
    itemCount: index.summaries.length,
    summaries: index.summaries,
  };
}

export function withProductLaunchListSnapshot(
  stateInput: ProductLaunchTrackerState,
): ProductLaunchTrackerState {
  const state = isRecord(stateInput) ? stateInput : {};
  return {
    ...state,
    [PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD]:
      buildProductLaunchListSnapshot(state),
  };
}

export function parseProductLaunchListSnapshot(
  value: unknown,
): ProductLaunchTrackerListSnapshot | null {
  if (!isRecord(value)) return null;
  if (Number(value.version) !== PRODUCT_LAUNCH_LIST_SNAPSHOT_VERSION) {
    return null;
  }
  if (!Array.isArray(value.summaries)) return null;
  const summaries = value.summaries.filter(
    (entry): entry is ProductLaunchTrackerSummary =>
      isRecord(entry) && Boolean(text(entry.id)),
  );
  const itemCount = Math.max(0, Math.floor(Number(value.itemCount) || 0));
  if (itemCount !== summaries.length) return null;
  return {
    version: PRODUCT_LAUNCH_LIST_SNAPSHOT_VERSION,
    generatedAt: text(value.generatedAt),
    sourceSavedAt: nullableText(value.sourceSavedAt),
    sourceImportedAt: value.sourceImportedAt ?? null,
    policy: value.policy ?? null,
    itemCount,
    summaries,
  };
}

export function buildProductLaunchListIndex(
  snapshot: ProductLaunchTrackerListSnapshot,
): ProductLaunchTrackerListIndex {
  const summaries = snapshot.summaries;
  const summariesById = new Map<string, ProductLaunchTrackerSummary>();
  const byBatch = new Map<string, Set<string>>();
  const byAssignee = new Map<string, Set<string>>();
  const byOverall = new Map<string, Set<string>>();
  const unfinishedIds = new Set<string>();
  const batches = new Set<string>();
  const assignees = new Set<string>();

  for (const summary of summaries) {
    summariesById.set(summary.id, summary);
    if (summary.workBatch) {
      batches.add(summary.workBatch);
      addToSetMap(byBatch, summary.workBatch, summary.id);
    }
    const itemAssignees = new Set(
      Object.values(summary.stages ?? {})
        .map((stage) => stage.assignee)
        .filter(Boolean),
    );
    for (const assignee of itemAssignees) {
      assignees.add(assignee);
      addToSetMap(byAssignee, assignee, summary.id);
    }
    addToSetMap(byOverall, summary.overallStatus, summary.id);
    if (!["완료", "보관됨"].includes(summary.overallStatus)) {
      unfinishedIds.add(summary.id);
    }
  }

  const active = summaries.filter((item) => !item.archivedAt);
  return {
    snapshot,
    summaries,
    summariesById,
    byBatch,
    byAssignee,
    byOverall,
    unfinishedIds,
    counts: {
      전체: active.length,
      "등록 준비": active.filter((item) => item.readiness.ready).length,
      "진행 중": active.filter((item) => item.overallStatus === "진행 중")
        .length,
      보류: active.filter((item) => item.overallStatus === "보류").length,
      완료: active.filter((item) => item.overallStatus === "완료").length,
    },
    filterOptions: {
      batches: [...batches].sort(localeCompare),
      assignees: [...assignees].sort(localeCompare),
    },
  };
}

export function queryProductLaunchListPage(
  index: ProductLaunchTrackerListIndex,
  query: ProductLaunchTrackerPageQuery,
) {
  const pageSize = clampInteger(
    query.pageSize,
    PRODUCT_LAUNCH_DEFAULT_PAGE_SIZE,
    1,
    PRODUCT_LAUNCH_MAX_PAGE_SIZE,
  );
  const requestedPage = clampInteger(
    query.page,
    1,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const search = normalizeSearch(query.search);
  const batch = text(query.batch);
  const assignee = text(query.assignee);
  const overall = text(query.overall);
  const unfinishedOnly = booleanValue(query.unfinishedOnly, true);
  const sort = text(query.sort);
  const direction = text(query.direction) === "asc" ? "asc" : "desc";

  let candidateIds: Set<string> | null = null;
  candidateIds = intersectCandidate(
    candidateIds,
    batch ? index.byBatch.get(batch) ?? new Set<string>() : null,
  );
  candidateIds = intersectCandidate(
    candidateIds,
    assignee ? index.byAssignee.get(assignee) ?? new Set<string>() : null,
  );
  candidateIds = intersectCandidate(
    candidateIds,
    overall ? index.byOverall.get(overall) ?? new Set<string>() : null,
  );
  candidateIds = intersectCandidate(
    candidateIds,
    unfinishedOnly ? index.unfinishedIds : null,
  );

  let rows = candidateIds
    ? [...candidateIds]
        .map((id) => index.summariesById.get(id))
        .filter(
          (value): value is ProductLaunchTrackerSummary => Boolean(value),
        )
    : [...index.summaries];

  if (search) rows = rows.filter((item) => item.searchText.includes(search));
  rows.sort(summaryComparator(sort, direction));

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    pageCount,
    total,
    items: rows.slice(offset, offset + pageSize).map(stripSearchText),
    counts: index.counts,
    filterOptions: index.filterOptions,
  };
}

function summaryComparator(sort: string, direction: "asc" | "desc") {
  const sign = direction === "asc" ? 1 : -1;
  const stageKeys = new Set([
    "detailPage",
    "priceKeyword",
    "shoplingUpload",
    "marketRegistration",
    "orderMapping",
    "inventoryReflection",
  ]);
  const stageKey = stageKeys.has(sort) ? sort : "";
  return (
    left: ProductLaunchTrackerSummary,
    right: ProductLaunchTrackerSummary,
  ) => {
    let compared = 0;
    if (stageKey) {
      compared =
        statusRank(left.stages[stageKey]?.status) -
        statusRank(right.stages[stageKey]?.status);
    } else if (sort === "options") {
      compared = left.optionLabels
        .join(", ")
        .localeCompare(right.optionLabels.join(", "), "ko-KR", {
          numeric: true,
          sensitivity: "base",
        });
    } else if (sort === "readiness") {
      compared = Number(left.readiness.ready) - Number(right.readiness.ready);
    } else if (sort === "nextStage") {
      compared = left.nextStage.localeCompare(right.nextStage, "ko-KR", {
        numeric: true,
        sensitivity: "base",
      });
    } else if (sort && Object.prototype.hasOwnProperty.call(left, sort)) {
      compared = String((left as unknown as UnknownRecord)[sort] ?? "").localeCompare(
        String((right as unknown as UnknownRecord)[sort] ?? ""),
        "ko-KR",
        { numeric: true, sensitivity: "base" },
      );
    }
    if (!compared) return defaultSummaryCompare(left, right);
    return compared * sign;
  };
}

function defaultSummaryCompare(
  left: ProductLaunchTrackerSummary,
  right: ProductLaunchTrackerSummary,
) {
  const updated = timestamp(right.updatedAt) - timestamp(left.updatedAt);
  if (updated) return updated;
  return right.modelNumber.localeCompare(left.modelNumber, "ko-KR", {
    numeric: true,
    sensitivity: "base",
  });
}

function stripSearchText(item: ProductLaunchTrackerSummary) {
  const { searchText: _searchText, ...summary } = item;
  return summary;
}

function intersectCandidate(
  current: Set<string> | null,
  next?: Set<string> | null,
) {
  if (!next) return current;
  if (!current) return new Set(next);
  const result = new Set<string>();
  const [small, large] =
    current.size <= next.size ? [current, next] : [next, current];
  for (const value of small) if (large.has(value)) result.add(value);
  return result;
}

function addToSetMap(map: Map<string, Set<string>>, key: string, id: string) {
  const values = map.get(key) ?? new Set<string>();
  values.add(id);
  map.set(key, values);
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "off", "no"].includes(text(value).toLowerCase());
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, " ");
}

function timestamp(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusRank(status: string) {
  return ["미시작", "진행 중", "보류", "완료", "제외"].indexOf(status);
}

function localeCompare(left: string, right: string) {
  return left.localeCompare(right, "ko-KR", {
    numeric: true,
    sensitivity: "base",
  });
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function text(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value).trim();
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
