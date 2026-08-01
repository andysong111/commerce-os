export type ShoplingCategoryEntryLike = {
  depth: number;
  path: string;
  names: string[];
  codes: string[];
};

export type ProductCategoryInput = {
  itemId: string;
  modelNumber: string;
  productName: string;
  optionLabels: string[];
  currentCategory: string;
  chinaProductLinks: string[];
};

export type CategoryCandidate = {
  path: string;
  score: number;
};

const MAX_PRODUCTS = 25;
const MAX_CANDIDATES = 18;

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return text(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function tokens(value: unknown) {
  return (
    text(value)
      .toLocaleLowerCase("ko-KR")
      .match(/[0-9a-z가-힣]{2,}/g) ?? []
  );
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

export function scoreShoplingCategoryCandidate(
  productText: string,
  categoryPath: string,
) {
  const productCompact = compact(productText);
  const pathCompact = compact(categoryPath);
  const leaf = text(categoryPath.split(">").at(-1));
  const leafCompact = compact(leaf);
  let score = 0;
  if (leafCompact && productCompact.includes(leafCompact)) score += 30;
  if (productCompact && pathCompact.includes(productCompact)) score += 20;
  for (const token of new Set(tokens(productText))) {
    const key = compact(token);
    if (key.length < 2) continue;
    if (leafCompact.includes(key)) score += 8;
    else if (pathCompact.includes(key)) score += 4;
  }
  for (const token of new Set(tokens(categoryPath))) {
    const key = compact(token);
    if (key.length >= 2 && productCompact.includes(key)) score += 5;
  }
  score += jaccard(bigrams(productText), bigrams(leaf)) * 18;
  score += jaccard(bigrams(productText), bigrams(categoryPath)) * 7;
  return Number(score.toFixed(4));
}

export function shortlistShoplingCategories(
  input: ProductCategoryInput,
  categories: ShoplingCategoryEntryLike[],
  limit = MAX_CANDIDATES,
): CategoryCandidate[] {
  const productText = [
    input.productName,
    input.modelNumber,
    ...input.optionLabels,
  ]
    .filter(Boolean)
    .join(" ");
  return categories
    .map((entry) => ({
      path: entry.path,
      score: scoreShoplingCategoryCandidate(productText, entry.path),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path, "ko-KR"),
    )
    .slice(0, Math.max(5, Math.min(30, limit)));
}

export function parseProductCategoryInputs(value: unknown): ProductCategoryInput[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI 카테고리 요청 형식이 올바르지 않습니다.");
  }
  const source = value as { items?: unknown };
  if (!Array.isArray(source.items) || !source.items.length) {
    throw new Error("AI 카테고리를 설정할 상품을 선택하세요.");
  }
  if (source.items.length > MAX_PRODUCTS) {
    throw new Error(`AI 카테고리는 한 번에 최대 ${MAX_PRODUCTS}개까지 처리합니다.`);
  }
  return source.items.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${index + 1}번째 상품 형식이 올바르지 않습니다.`);
    }
    const row = raw as Record<string, unknown>;
    const itemId = text(row.itemId ?? row.id);
    const modelNumber = text(row.modelNumber).slice(0, 80);
    const productName = text(row.productName).slice(0, 240);
    if (!itemId || !productName) {
      throw new Error(`${index + 1}번째 상품의 ID와 모델명이 필요합니다.`);
    }
    return {
      itemId,
      modelNumber,
      productName,
      optionLabels: Array.isArray(row.optionLabels)
        ? row.optionLabels.map(text).filter(Boolean).slice(0, 30)
        : [],
      currentCategory: text(row.currentCategory).slice(0, 300),
      chinaProductLinks: Array.isArray(row.chinaProductLinks)
        ? row.chinaProductLinks.map(text).filter(Boolean).slice(0, 5)
        : [],
    };
  });
}
