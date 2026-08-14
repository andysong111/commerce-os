import {
  hasShoplingInventoryPseudoCategorySegment,
  sanitizeShoplingCategoryPath,
  sanitizeShoplingCategoryPathArray,
} from "@/lib/shoplingCategoryPathSafety";

export type ShoplingCategoryReviewStatus =
  | "review_required"
  | "review_held"
  | "review_excluded"
  | "review_approved";

export type ShoplingCategoryReviewAction =
  | "approve"
  | "hold"
  | "exclude"
  | "restore";

export type ShoplingCategoryReviewDecision = {
  itemId: string;
  action: ShoplingCategoryReviewAction;
  category?: string;
};

export type ShoplingCategoryReviewRow = {
  itemId: string;
  modelNumber: string;
  productName: string;
  currentCategory: string;
  suggestion: string;
  confidence: number;
  reason: string;
  alternatives: string[];
  status: ShoplingCategoryReviewStatus;
  batchId: string;
  batchLabel: string;
  snapshotHash: string;
  updatedAt: string;
  reviewedAt: string;
  approvedValue: string;
};

export type ShoplingCategoryReviewCounts = {
  required: number;
  held: number;
  approved: number;
  excluded: number;
  total: number;
};

type TrackerState = Record<string, unknown> & {
  items?: unknown[];
};

type TrackerItem = Record<string, unknown>;

const REVIEW_STATUSES = new Set<ShoplingCategoryReviewStatus>([
  "review_required",
  "review_held",
  "review_excluded",
  "review_approved",
]);

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function confidence(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, Math.round(numeric)))
    : 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).slice(0, 5)
    : [];
}

function categoryArray(value: unknown) {
  return sanitizeShoplingCategoryPathArray(stringArray(value), 5);
}

function normalizeStatus(item: TrackerItem): ShoplingCategoryReviewStatus | null {
  const raw = text(item.categoryAiStatus) as ShoplingCategoryReviewStatus;
  if (REVIEW_STATUSES.has(raw)) return raw;
  const suggestion = sanitizeShoplingCategoryPath(item.categoryAiSuggestion);
  const currentCategory = sanitizeShoplingCategoryPath(item.shoplingCategory);
  if (suggestion && !currentCategory) return "review_required";
  return null;
}

function batchValue(item: TrackerItem) {
  const explicit = text(item.categoryAiBatchId);
  if (explicit) return explicit;
  const updatedAt = text(item.categoryAiUpdatedAt);
  if (updatedAt) return updatedAt;
  return "legacy";
}

function batchLabel(value: string) {
  if (value === "legacy") return "이전 작업";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value.slice(0, 28);
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function buildShoplingCategoryReviewRows(
  state: unknown,
): ShoplingCategoryReviewRow[] {
  if (!state || typeof state !== "object" || Array.isArray(state)) return [];
  const items = Array.isArray((state as TrackerState).items)
    ? (state as TrackerState).items!
    : [];

  const rows: ShoplingCategoryReviewRow[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as TrackerItem;
    if (item.archivedAt) continue;
    const itemId = text(item.id);
    const suggestion = sanitizeShoplingCategoryPath(item.categoryAiSuggestion);
    const status = normalizeStatus(item);
    if (!itemId || !suggestion || !status || seen.has(itemId)) continue;
    seen.add(itemId);
    const batchId = batchValue(item);
    rows.push({
      itemId,
      modelNumber: text(item.modelNumber),
      productName: text(item.productName),
      currentCategory: sanitizeShoplingCategoryPath(item.shoplingCategory),
      suggestion,
      confidence: confidence(item.categoryAiConfidence),
      reason: text(item.categoryAiReason),
      alternatives: categoryArray(item.categoryAiAlternatives),
      status,
      batchId,
      batchLabel: batchLabel(batchId),
      snapshotHash: text(item.categoryAiSnapshotHash),
      updatedAt: text(item.categoryAiUpdatedAt),
      reviewedAt: text(item.categoryAiReviewedAt),
      approvedValue: sanitizeShoplingCategoryPath(item.categoryAiApprovedValue),
    });
  }

  return rows.sort((left, right) => {
    const statusOrder: Record<ShoplingCategoryReviewStatus, number> = {
      review_required: 0,
      review_held: 1,
      review_approved: 2,
      review_excluded: 3,
    };
    return (
      statusOrder[left.status] - statusOrder[right.status] ||
      left.confidence - right.confidence ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.modelNumber.localeCompare(right.modelNumber, "ko-KR")
    );
  });
}

export function countShoplingCategoryReviews(
  rows: readonly ShoplingCategoryReviewRow[],
): ShoplingCategoryReviewCounts {
  const result: ShoplingCategoryReviewCounts = {
    required: 0,
    held: 0,
    approved: 0,
    excluded: 0,
    total: rows.length,
  };
  for (const row of rows) {
    if (row.status === "review_required") result.required += 1;
    else if (row.status === "review_held") result.held += 1;
    else if (row.status === "review_approved") result.approved += 1;
    else if (row.status === "review_excluded") result.excluded += 1;
  }
  return result;
}

export function applyShoplingCategoryReviewDecisions(
  state: unknown,
  decisions: readonly ShoplingCategoryReviewDecision[],
  options: { now?: string; reviewer?: string } = {},
) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("진행관리 state 객체가 필요합니다.");
  }
  const source = state as TrackerState;
  if (!Array.isArray(source.items)) {
    throw new Error("진행관리 상품 목록(items)이 필요합니다.");
  }
  const decisionById = new Map<string, ShoplingCategoryReviewDecision>();
  for (const decision of decisions) {
    const itemId = text(decision.itemId);
    if (!itemId) continue;
    decisionById.set(itemId, { ...decision, itemId });
  }
  if (!decisionById.size) {
    throw new Error("처리할 카테고리 검토 항목을 선택하세요.");
  }

  const now = options.now ?? new Date().toISOString();
  const reviewer = text(options.reviewer) || "AI 카테고리 검토함";
  let appliedCount = 0;
  const items = source.items.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const item = raw as TrackerItem;
    const itemId = text(item.id);
    const decision = decisionById.get(itemId);
    if (!decision) return item;
    const rawSuggestion = text(item.categoryAiSuggestion);
    const suggestion = sanitizeShoplingCategoryPath(rawSuggestion);
    const explicitApprovedCategory =
      decision.action === "approve"
        ? sanitizeShoplingCategoryPath(decision.category)
        : "";
    if (!suggestion && !explicitApprovedCategory) return item;

    const effectiveSuggestion = suggestion || explicitApprovedCategory;
    const next: TrackerItem = {
      ...item,
      categoryAiSuggestion: effectiveSuggestion,
      categoryAiAlternatives: categoryArray(item.categoryAiAlternatives),
      categoryAiCandidateChoices: categoryArray(item.categoryAiCandidateChoices),
      categoryAiCandidatePaths: categoryArray(item.categoryAiCandidatePaths),
    };
    const cleanCurrentCategory = sanitizeShoplingCategoryPath(item.shoplingCategory);
    if (cleanCurrentCategory) next.shoplingCategory = cleanCurrentCategory;

    if (decision.action === "approve") {
      const approvedCategory =
        explicitApprovedCategory ||
        sanitizeShoplingCategoryPath(text(decision.category) || rawSuggestion);
      if (!approvedCategory) {
        throw new Error(`${text(item.modelNumber) || itemId}의 승인 카테고리가 비어 있습니다.`);
      }
      if (hasShoplingInventoryPseudoCategorySegment(approvedCategory)) {
        throw new Error(
          `${text(item.modelNumber) || itemId}의 승인 카테고리에 재고 방식이 포함되어 있습니다. 후보를 다시 생성하세요.`,
        );
      }
      next.shoplingCategory = approvedCategory;
      next.categoryAiApprovedValue = approvedCategory;
      next.categoryAiStatus = "review_approved";
      next.categoryAiDecision =
        suggestion && approvedCategory === suggestion ? "suggestion" : "edited";
      next.categoryAiReviewedAt = now;
      next.categoryAiReviewedBy = reviewer;
      next.updatedAt = now;
      next.updatedBy = "AI 카테고리 검토 승인";
    } else if (decision.action === "hold") {
      next.categoryAiStatus = "review_held";
      next.categoryAiReviewedAt = now;
      next.categoryAiReviewedBy = reviewer;
      next.updatedAt = now;
      next.updatedBy = "AI 카테고리 검토 보류";
    } else if (decision.action === "exclude") {
      next.categoryAiStatus = "review_excluded";
      next.categoryAiReviewedAt = now;
      next.categoryAiReviewedBy = reviewer;
      next.updatedAt = now;
      next.updatedBy = "AI 카테고리 검토 제외";
    } else if (decision.action === "restore") {
      next.categoryAiStatus = "review_required";
      next.categoryAiReviewedAt = "";
      next.categoryAiReviewedBy = "";
      next.updatedAt = now;
      next.updatedBy = "AI 카테고리 재검토 전환";
    }
    appliedCount += 1;
    return next;
  });

  if (!appliedCount) {
    throw new Error("선택한 검토 항목을 진행관리 상품에서 찾지 못했습니다.");
  }
  return {
    state: {
      ...source,
      savedAt: now,
      items,
    },
    appliedCount,
  };
}

export function isShoplingCategoryReviewStale(
  row: ShoplingCategoryReviewRow,
  currentSnapshotHash: string,
) {
  return Boolean(
    row.snapshotHash &&
      currentSnapshotHash &&
      row.snapshotHash !== currentSnapshotHash,
  );
}
