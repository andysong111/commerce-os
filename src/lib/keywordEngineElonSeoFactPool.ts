import {
  compactKeywordElonKey,
  validate1688Url,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";

export type KeywordElonSeoSourceMode =
  | "1688_full"
  | "legacy_fallback"
  | "vision_recovery";

export type KeywordElonSeoFactConfidence = "A" | "B" | "C";

export type KeywordElonSeoFactKind =
  | "core"
  | "target"
  | "function"
  | "use"
  | "context"
  | "form"
  | "material"
  | "spec"
  | "bundle"
  | "option"
  | "category"
  | "identity";

export type KeywordElonSeoFact = {
  value: string;
  kind: KeywordElonSeoFactKind;
  source: string;
  confidence: KeywordElonSeoFactConfidence;
  titleAllowed: boolean;
};

type UnknownRecord = Record<string, unknown>;

const MATERIAL_PATTERN = /(실리콘|스테인리스|스텐|알루미늄|아크릴|플라스틱|고무|가죽|pu가죽|합성피혁|면|코튼|폴리에스터|나일론|유리|우드|나무|금속|철제|세라믹)/i;
const SPEC_PATTERN = /\b\d+(?:\.\d+)?\s*(?:mm|cm|m|ml|l|g|kg|개|매|장|쌍|세트|입|호|인치)\b/i;
const BUNDLE_PATTERN = /\b\d+\s*(?:개|매|장|쌍|세트|입)\b/i;
const FORM_PATTERN = /(원형|사각|직사각|슬림|롱|미니|소형|대형|접이식|걸이형|스텝형|판형|보드형|파우치형|케이스형|스틱형|브러시|브러쉬|스텝퍼|거치대|수납함|파우치|노트|수건|판)$/i;
const FUNCTION_PATTERN = /(청소|지압|마사지|수납|정리|보관|고정|보호|제거|세척|건조|거치|압출|천공|밀봉|차단|흡수|미끄럼방지)/i;
const CONTEXT_PATTERN = /(주방|욕실|화장실|차량|자동차|사무실|실내|야외|캠핑|여행|현관|창틀|책상|침실|거실|학교|홈트)/i;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value: unknown) {
  return text(value)
    .replace(/\([^)]*[\u3400-\u9fff][^)]*\)/g, " ")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[()[\]{}<>]/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitFacts(value: unknown, limit = 40) {
  const raw = text(value);
  if (!raw) return [];
  const pieces = raw
    .split(/[\n·|/;,]+/)
    .map(clean)
    .filter(Boolean);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const piece of pieces) {
    const key = compactKeywordElonKey(piece);
    if (!key || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    result.push(piece);
    if (result.length >= limit) break;
  }
  return result;
}

function classify(value: string, fallback: KeywordElonSeoFactKind): KeywordElonSeoFactKind {
  if (BUNDLE_PATTERN.test(value)) return "bundle";
  if (SPEC_PATTERN.test(value)) return "spec";
  if (MATERIAL_PATTERN.test(value)) return "material";
  if (CONTEXT_PATTERN.test(value)) return "context";
  if (FUNCTION_PATTERN.test(value)) return "function";
  if (FORM_PATTERN.test(value)) return "form";
  if (/용$/.test(value)) return "use";
  return fallback;
}

function pushFact(
  target: KeywordElonSeoFact[],
  seen: Set<string>,
  value: unknown,
  input: Omit<KeywordElonSeoFact, "value" | "kind"> & { kind: KeywordElonSeoFactKind },
) {
  const normalized = clean(value);
  const key = compactKeywordElonKey(normalized);
  if (!key || key.length < 2 || seen.has(key)) return;
  if (/^(모델번호|상품코드|바코드)\s*/i.test(normalized)) return;
  seen.add(key);
  target.push({
    value: normalized,
    kind: classify(normalized, input.kind),
    source: input.source,
    confidence: input.confidence,
    titleAllowed: input.titleAllowed,
  });
}

export function resolveKeywordElonSeoSourceMode(input: {
  sourceUrl?: unknown;
  hasImageEvidence?: boolean;
}): KeywordElonSeoSourceMode {
  if (validate1688Url(text(input.sourceUrl))) return "1688_full";
  if (input.hasImageEvidence) return "legacy_fallback";
  return "legacy_fallback";
}

export function buildKeywordElonSeoFactPool(input: {
  source?: KeywordElonSourceDraft | null;
  identity?: KeywordElonIdentity | null;
  productName?: unknown;
  category?: unknown;
  optionText?: unknown;
  supportingText?: unknown;
  searchKeywords?: unknown[];
}) {
  const facts: KeywordElonSeoFact[] = [];
  const seen = new Set<string>();
  const identity = input.identity ?? ({} as KeywordElonIdentity);
  const source = input.source ?? ({} as KeywordElonSourceDraft);

  pushFact(facts, seen, input.productName, {
    kind: "core",
    source: "product_launch_name",
    confidence: "A",
    titleAllowed: true,
  });
  pushFact(facts, seen, input.category, {
    kind: "category",
    source: "shopling_category",
    confidence: "A",
    titleAllowed: true,
  });

  for (const value of splitFacts(input.optionText, 50)) {
    pushFact(facts, seen, value, {
      kind: "option",
      source: "product_launch_option",
      confidence: "A",
      titleAllowed: true,
    });
  }

  const identityGroups: Array<[
    unknown[] | undefined,
    KeywordElonSeoFactKind,
    string,
  ]> = [
    [identity.primarySeeds, "identity", "identity_primary_seed"],
    [identity.conditionalSeeds, "context", "identity_conditional_seed"],
    [identity.functionModifiers, "function", "identity_function"],
    [identity.designShapeModifiers, "form", "identity_design_shape"],
    [identity.specAttributes, "spec", "identity_spec"],
  ];
  for (const [values, kind, sourceName] of identityGroups) {
    for (const value of values ?? []) {
      pushFact(facts, seen, value, {
        kind,
        source: sourceName,
        confidence: "B",
        titleAllowed: true,
      });
    }
  }
  for (const value of [identity.coreProduct, identity.koreanProductIdentity, identity.identityAnchor]) {
    pushFact(facts, seen, value, {
      kind: "identity",
      source: "identity_anchor",
      confidence: "B",
      titleAllowed: true,
    });
  }

  if (validate1688Url(source.url)) {
    for (const value of splitFacts(source.optionText, 50)) {
      pushFact(facts, seen, value, {
        kind: "option",
        source: "1688_option",
        confidence: "A",
        titleAllowed: true,
      });
    }
  }

  for (const value of input.searchKeywords ?? []) {
    const row = record(value);
    const keyword = text(row.keyword || value);
    pushFact(facts, seen, keyword, {
      kind: "identity",
      source: "validated_search_keyword",
      confidence: "A",
      titleAllowed: true,
    });
  }

  for (const value of splitFacts(input.supportingText, 30)) {
    if (/^모델번호\s+/i.test(value)) continue;
    pushFact(facts, seen, value, {
      kind: "context",
      source: "tracker_supporting_text",
      confidence: "C",
      titleAllowed: false,
    });
  }

  return facts.slice(0, 120);
}

export function factPoolTitleMaterials(facts: KeywordElonSeoFact[]) {
  return facts
    .filter((fact) => fact.titleAllowed && (fact.confidence === "A" || fact.confidence === "B"))
    .map((fact) => fact.value);
}
