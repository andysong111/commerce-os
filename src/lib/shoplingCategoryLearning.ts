import { sanitizeShoplingCategoryPath } from "@/lib/shoplingCategoryPathSafety";
import type { ProductCategoryInput } from "@/lib/shoplingCategoryScoring";

export const SHOPLING_CATEGORY_ENGINE_VERSION = "shopling-first-learning-v1";

export type ShoplingCategoryApprovalExample = {
  itemId: string;
  modelNumber: string;
  productName: string;
  optionLabels: string[];
  approvedPath: string;
  suggestedPath: string;
  candidatePaths: string[];
  engineVersion: string;
  reviewedAt: string;
};

export type ShoplingCategoryAccuracyMetrics = {
  approvedCount: number;
  top1Correct: number;
  top3Covered: number;
  top1Rate: number;
  top3Rate: number;
  byEngine: Array<{
    engineVersion: string;
    approvedCount: number;
    top1Rate: number;
    top3Rate: number;
  }>;
};

export type ShoplingCategoryApprovalPrior = {
  path: string;
  similarity: number;
  supportCount: number;
  score: number;
};

type RecordLike = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function record(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function stringArray(value: unknown, limit = 12) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const raw of value) {
    const normalized = text(raw);
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function optionLabels(item: RecordLike) {
  if (!Array.isArray(item.orderOptions)) return [];
  return item.orderOptions
    .map((raw) => {
      const option = record(raw);
      return text(option?.saleOption);
    })
    .filter(Boolean)
    .slice(0, 12);
}

function candidatePaths(item: RecordLike) {
  const values = [
    item.categoryAiSuggestion,
    ...stringArray(item.categoryAiCandidateChoices, 5),
    ...stringArray(item.categoryAiAlternatives, 5),
    ...stringArray(item.categoryAiCandidatePaths, 8),
  ];
  const result: string[] = [];
  for (const raw of values) {
    const path = sanitizeShoplingCategoryPath(raw);
    if (!path || result.includes(path)) continue;
    result.push(path);
    if (result.length >= 8) break;
  }
  return result;
}

export function buildShoplingCategoryApprovalExamples(
  state: unknown,
  limit = 300,
): ShoplingCategoryApprovalExample[] {
  const source = record(state);
  const items = Array.isArray(source?.items) ? source!.items : [];
  const examples: ShoplingCategoryApprovalExample[] = [];
  for (const raw of items) {
    const item = record(raw);
    if (!item || item.archivedAt) continue;
    const approvedPath = sanitizeShoplingCategoryPath(
      item.categoryAiApprovedValue ||
        (text(item.categoryAiStatus) === "review_approved"
          ? item.shoplingCategory
          : ""),
    );
    if (!approvedPath) continue;
    examples.push({
      itemId: text(item.id),
      modelNumber: text(item.modelNumber),
      productName: text(item.productName),
      optionLabels: optionLabels(item),
      approvedPath,
      suggestedPath: sanitizeShoplingCategoryPath(item.categoryAiSuggestion),
      candidatePaths: candidatePaths(item),
      engineVersion:
        text(item.categoryAiEngineVersion) || "legacy-before-learning-v1",
      reviewedAt:
        text(item.categoryAiReviewedAt) ||
        text(item.categoryAiUpdatedAt) ||
        text(item.updatedAt),
    });
  }
  return examples
    .sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt))
    .slice(0, Math.max(1, limit));
}

function rate(correct: number, total: number) {
  return total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;
}

export function computeShoplingCategoryAccuracyMetrics(
  state: unknown,
): ShoplingCategoryAccuracyMetrics {
  const examples = buildShoplingCategoryApprovalExamples(state, 5_000);
  let top1Correct = 0;
  let top3Covered = 0;
  const byEngine = new Map<
    string,
    { approvedCount: number; top1Correct: number; top3Covered: number }
  >();

  for (const example of examples) {
    const top1 = example.suggestedPath === example.approvedPath;
    const top3 = example.candidatePaths.slice(0, 3).includes(example.approvedPath);
    if (top1) top1Correct += 1;
    if (top3) top3Covered += 1;
    const group = byEngine.get(example.engineVersion) ?? {
      approvedCount: 0,
      top1Correct: 0,
      top3Covered: 0,
    };
    group.approvedCount += 1;
    if (top1) group.top1Correct += 1;
    if (top3) group.top3Covered += 1;
    byEngine.set(example.engineVersion, group);
  }

  return {
    approvedCount: examples.length,
    top1Correct,
    top3Covered,
    top1Rate: rate(top1Correct, examples.length),
    top3Rate: rate(top3Covered, examples.length),
    byEngine: [...byEngine.entries()]
      .map(([engineVersion, group]) => ({
        engineVersion,
        approvedCount: group.approvedCount,
        top1Rate: rate(group.top1Correct, group.approvedCount),
        top3Rate: rate(group.top3Covered, group.approvedCount),
      }))
      .sort(
        (left, right) =>
          right.approvedCount - left.approvedCount ||
          left.engineVersion.localeCompare(right.engineVersion),
      ),
  };
}

function compact(value: unknown) {
  return text(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function bigrams(value: unknown) {
  const source = compact(value);
  const result = new Set<string>();
  for (let index = 0; index < source.length - 1; index += 1) {
    result.add(source.slice(index, index + 2));
  }
  return result;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function identityText(productName: string, options: readonly string[]) {
  return [productName, ...options]
    .map(text)
    .filter(Boolean)
    .join(" ");
}

export function shoplingApprovalIdentitySimilarity(
  left: { productName: string; optionLabels: readonly string[] },
  right: { productName: string; optionLabels: readonly string[] },
) {
  const leftName = compact(left.productName);
  const rightName = compact(right.productName);
  if (!leftName || !rightName) return 0;
  if (leftName === rightName) return 1;
  if (
    Math.min(leftName.length, rightName.length) >= 4 &&
    (leftName.includes(rightName) || rightName.includes(leftName))
  ) {
    return 0.88;
  }
  const fullLeft = identityText(left.productName, left.optionLabels);
  const fullRight = identityText(right.productName, right.optionLabels);
  const nameScore = jaccard(bigrams(left.productName), bigrams(right.productName));
  const fullScore = jaccard(bigrams(fullLeft), bigrams(fullRight));
  return Math.max(nameScore, nameScore * 0.75 + fullScore * 0.25);
}

export function findShoplingCategoryApprovalPrior(
  input: ProductCategoryInput,
  examples: readonly ShoplingCategoryApprovalExample[],
  validPaths: ReadonlySet<string>,
): ShoplingCategoryApprovalPrior | null {
  const byPath = new Map<
    string,
    { weighted: number; similarityMax: number; supportCount: number }
  >();
  for (const example of examples) {
    if (!example.approvedPath || !validPaths.has(example.approvedPath)) continue;
    if (example.itemId && example.itemId === input.itemId) continue;
    const similarity = shoplingApprovalIdentitySimilarity(input, example);
    if (similarity < 0.38) continue;
    const current = byPath.get(example.approvedPath) ?? {
      weighted: 0,
      similarityMax: 0,
      supportCount: 0,
    };
    current.weighted += similarity * similarity;
    current.similarityMax = Math.max(current.similarityMax, similarity);
    current.supportCount += 1;
    byPath.set(example.approvedPath, current);
  }

  const ranked = [...byPath.entries()]
    .map(([path, value]) => ({
      path,
      similarity: value.similarityMax,
      supportCount: value.supportCount,
      score:
        value.weighted +
        Math.min(0.35, Math.max(0, value.supportCount - 1) * 0.08),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.similarity - left.similarity ||
        right.supportCount - left.supportCount,
    );
  const best = ranked[0];
  if (!best) return null;
  const strongSingle = best.similarity >= 0.58;
  const repeated = best.supportCount >= 2 && best.similarity >= 0.46;
  return strongSingle || repeated ? best : null;
}
