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
  intentMatched?: boolean;
  evidence?: string[];
};

export type ShoplingCategoryIntent = {
  key: string;
  coreTerm: string;
  relatedTerms: string[];
  blockedTerms: string[];
  rationale: string;
};

const MAX_PRODUCTS = 25;
const MAX_CANDIDATES = 18;

const INTENT_RULES: readonly ShoplingCategoryIntent[] = [
  {
    key: "thimble",
    coreTerm: "골무",
    relatedTerms: [
      "골무",
      "바느질",
      "재봉",
      "수예",
      "봉제",
      "재봉용품",
      "수예용품",
      "바느질용품",
      "손가락보호",
      "손가락 보호",
      "손가락보호대",
      "보호대",
      "공예",
    ],
    blockedTerms: [
      "타이즈",
      "스타킹",
      "내의",
      "레깅스",
      "양말",
      "속옷",
      "수영복",
      "의류",
      "축구",
      "야구",
      "골프",
      "헬멧",
      "투구",
    ],
    rationale:
      "결합 모델명에 다른 단어가 붙어 있어도 제품 핵심명사 '골무'를 우선하고 수예·재봉·손가락 보호 계열만 후보로 사용합니다.",
  },
] as const;

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

export function inferShoplingCategoryIntent(
  input: Pick<ProductCategoryInput, "productName" | "optionLabels">,
): ShoplingCategoryIntent | null {
  const source = compact([input.productName, ...input.optionLabels].join(" "));
  if (!source) return null;
  return (
    INTENT_RULES.find((rule) => source.includes(compact(rule.coreTerm))) ?? null
  );
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

function scoreIntent(
  categoryPath: string,
  intent: ShoplingCategoryIntent | null,
) {
  if (!intent) {
    return { score: 0, matched: false, blocked: false, evidence: [] as string[] };
  }
  const pathCompact = compact(categoryPath);
  const leafCompact = compact(categoryPath.split(">").at(-1));
  const evidence: string[] = [];
  let intentScore = 0;

  for (const blockedTerm of intent.blockedTerms) {
    const key = compact(blockedTerm);
    if (key && pathCompact.includes(key)) {
      return {
        score: -1_000,
        matched: false,
        blocked: true,
        evidence: [`차단:${blockedTerm}`],
      };
    }
  }

  for (const [index, relatedTerm] of intent.relatedTerms.entries()) {
    const key = compact(relatedTerm);
    if (!key || !pathCompact.includes(key)) continue;
    const isCore = key === compact(intent.coreTerm);
    const leafMatch = leafCompact.includes(key);
    const weight = isCore ? 260 : index <= 3 ? 150 : index <= 7 ? 110 : 70;
    intentScore += weight + (leafMatch ? 45 : 0);
    evidence.push(relatedTerm);
  }

  return {
    score: intentScore,
    matched: evidence.length > 0,
    blocked: false,
    evidence,
  };
}

export function shortlistShoplingCategories(
  input: ProductCategoryInput,
  categories: ShoplingCategoryEntryLike[],
  limit = MAX_CANDIDATES,
): CategoryCandidate[] {
  const productText = [
    input.productName,
    ...input.optionLabels,
    input.modelNumber,
  ]
    .filter(Boolean)
    .join(" ");
  const intent = inferShoplingCategoryIntent(input);
  const ranked = categories
    .map((entry) => {
      const baseScore = scoreShoplingCategoryCandidate(productText, entry.path);
      const intentResult = scoreIntent(entry.path, intent);
      return {
        path: entry.path,
        score: Number((baseScore + intentResult.score).toFixed(4)),
        baseScore,
        intentMatched: intentResult.matched,
        blocked: intentResult.blocked,
        evidence: intentResult.evidence,
      };
    })
    .filter((candidate) => !candidate.blocked)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path, "ko-KR"),
    );

  const requestedLimit = Math.max(5, Math.min(30, limit));
  if (intent) {
    const relevant = ranked.filter((candidate) => candidate.intentMatched);
    if (relevant.length) {
      return relevant.slice(0, requestedLimit).map(({ path, score, intentMatched, evidence }) => ({
        path,
        score,
        intentMatched,
        evidence,
      }));
    }
  }

  return ranked.slice(0, requestedLimit).map(({ path, score, intentMatched, evidence }) => ({
    path,
    score,
    intentMatched,
    evidence,
  }));
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
