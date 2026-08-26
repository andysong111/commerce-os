export type KeywordElonFactKind =
  | "core"
  | "keyword"
  | "function"
  | "use_context"
  | "shape"
  | "spec"
  | "option"
  | "category"
  | "identity";

export type KeywordElonFactConfidence = "A" | "B";

export type KeywordElonFact = {
  value: string;
  kind: KeywordElonFactKind;
  source: string;
  confidence: KeywordElonFactConfidence;
  titleEligible: boolean;
};

type IdentityLike = {
  koreanProductIdentity?: string;
  coreProduct?: string;
  identityAnchor?: string;
  primarySeeds?: string[];
  conditionalSeeds?: string[];
  functionModifiers?: string[];
  designShapeModifiers?: string[];
  specAttributes?: string[];
};

type SearchKeywordLike = {
  keyword?: string;
  sourceMaterials?: string[];
};

export type KeywordElonFactPoolInput = {
  productName: string;
  modelNumber?: string;
  optionText?: string;
  supportingText?: string;
  identity: IdentityLike;
  searchKeywords?: SearchKeywordLike[];
  blockedTerms?: string[];
};

const UNSUPPORTED_MARKETING_TERMS = [
  "인기",
  "베스트",
  "최고",
  "최상",
  "추천상품",
  "프리미엄",
  "명품",
  "정품보장",
  "완벽",
] as const;

const GENERIC_ONLY = new Set([
  "상품",
  "제품",
  "용품",
  "도구",
  "옵션",
  "모델",
  "모델번호",
]);

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function canonical(value: unknown) {
  return text(value).toLocaleLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function splitFacts(value: unknown) {
  return text(value)
    .split(/[\n\r·•|/;,]+/g)
    .map((entry) => text(entry))
    .filter(Boolean);
}

function cleanFact(value: unknown) {
  return text(value)
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[()[\]{}<>]/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function codeLike(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (/^[A-Z]{1,6}[0-9-]{1,16}$/i.test(compact)) return true;
  if (/^[0-9]{8,}$/.test(compact)) return true;
  return false;
}

function isEligible(
  value: string,
  modelNumber: string,
  blockedTerms: string[],
) {
  const key = canonical(value);
  if (!key || key.length < 2 || utf8Bytes(value) > 40) return false;
  if (GENERIC_ONLY.has(key) || codeLike(value)) return false;
  const modelKey = canonical(modelNumber);
  if (modelKey && (key === modelKey || key.includes(modelKey))) return false;
  const blocked = [
    ...UNSUPPORTED_MARKETING_TERMS,
    ...blockedTerms,
  ]
    .map(canonical)
    .filter(Boolean);
  return !blocked.some((blockedKey) => key.includes(blockedKey));
}

export function buildKeywordElonFactPool(
  input: KeywordElonFactPoolInput,
): KeywordElonFact[] {
  const result: KeywordElonFact[] = [];
  const seen = new Set<string>();
  const modelNumber = text(input.modelNumber);
  const blockedTerms = (input.blockedTerms ?? []).map(text).filter(Boolean);

  const add = (
    rawValue: unknown,
    kind: KeywordElonFactKind,
    source: string,
    confidence: KeywordElonFactConfidence,
  ) => {
    const value = cleanFact(rawValue);
    const key = canonical(value);
    if (!key || seen.has(key)) return;
    const titleEligible = isEligible(value, modelNumber, blockedTerms);
    if (!titleEligible) return;
    seen.add(key);
    result.push({ value, kind, source, confidence, titleEligible });
  };

  add(input.productName, "identity", "product_launch.product_name", "A");

  for (const value of splitFacts(input.supportingText)) {
    add(value, "category", "product_launch.supporting_text", "A");
  }
  for (const value of splitFacts(input.optionText)) {
    add(value, "option", "product_launch.option", "A");
  }

  const identity = input.identity ?? {};
  add(identity.coreProduct, "core", "identity.core_product", "B");
  add(identity.koreanProductIdentity, "identity", "identity.korean_product_identity", "B");
  add(identity.identityAnchor, "identity", "identity.anchor", "B");
  for (const value of identity.primarySeeds ?? []) {
    add(value, "keyword", "identity.primary_seed", "B");
  }
  for (const value of identity.conditionalSeeds ?? []) {
    add(value, "use_context", "identity.conditional_seed", "B");
  }
  for (const value of identity.functionModifiers ?? []) {
    add(value, "function", "identity.function_modifier", "B");
  }
  for (const value of identity.designShapeModifiers ?? []) {
    add(value, "shape", "identity.design_shape_modifier", "B");
  }
  for (const value of identity.specAttributes ?? []) {
    add(value, "spec", "identity.spec_attribute", "B");
  }

  for (const row of input.searchKeywords ?? []) {
    add(row.keyword, "keyword", "validated_search_keyword", "A");
    for (const material of row.sourceMaterials ?? []) {
      add(material, "keyword", "validated_search_material", "A");
    }
  }

  return result.slice(0, 80);
}

export function keywordElonFactPoolValues(facts: KeywordElonFact[]) {
  return facts
    .filter((fact) => fact.titleEligible)
    .map((fact) => fact.value);
}
