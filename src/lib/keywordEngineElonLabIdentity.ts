export type KeywordEngineIdentityInput = {
  goodsKey: string;
  cleanedSeed: string;
};

export type KeywordEngineIdentityResult = {
  goodsKey: string;
  cleanedSeed: string;
  coreProduct: string;
  identityAnchor: string;
  functionModifiers: string[];
  designShapeModifiers: string[];
  specAttributes: string[];
  variantNoise: string[];
  uncertainTerms: string[];
  primaryProbes: string[];
  conditionalProbes: string[];
  blockedSingleProbes: string[];
  confidence: number;
  reasoning: string;
  model: string;
  classifier: "openai_semantic_identity_v2";
  probePolicy: string;
  warning: string;
};

type OpenAiFetch = typeof fetch;

type OpenAiResponse = {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      type?: unknown;
      text?: unknown;
    }>;
  }>;
  error?: { message?: unknown };
};

const MAX_ITEMS = 6;
const ROLE_KEYS = [
  "functionModifiers",
  "designShapeModifiers",
  "specAttributes",
  "variantNoise",
  "uncertainTerms",
] as const;

function text(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown) {
  return text(value)
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLocaleLowerCase();
}

function unique(values: string[], limit = 20) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = text(value);
    const key = compact(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function isGrounded(value: string, seed: string) {
  const key = compact(value);
  const seedKey = compact(seed);
  if (!key || !seedKey) return false;
  if (seedKey.includes(key)) return true;

  const pieces = text(value)
    .split(/\s+/)
    .map(compact)
    .filter((item) => item.length >= 1);
  return Boolean(pieces.length) && pieces.every((piece) => seedKey.includes(piece));
}

function groundedList(value: unknown, seed: string) {
  const source = Array.isArray(value) ? value : [];
  return unique(
    source
      .map((item) => text(item))
      .filter((item) => item && isGrounded(item, seed)),
    12,
  );
}

function addProbe(target: string[], value: string, blocked: Set<string>) {
  const normalized = text(value);
  const key = compact(normalized);
  if (!key || blocked.has(key)) return;
  if (target.some((item) => compact(item) === key)) return;
  target.push(normalized);
}

function joinProbe(left: string, right: string) {
  const a = text(left);
  const b = text(right);
  if (!a) return b;
  if (!b) return a;
  if (compact(b).includes(compact(a))) return b;
  if (compact(a).includes(compact(b))) return a;
  return `${a} ${b}`;
}

export function buildKeywordIdentityProbes(input: {
  coreProduct: string;
  identityAnchor: string;
  functionModifiers: string[];
  designShapeModifiers: string[];
  specAttributes: string[];
  variantNoise: string[];
  uncertainTerms: string[];
}) {
  const coreProduct = text(input.coreProduct);
  const identityAnchor = text(input.identityAnchor) || coreProduct;
  const blockedSingleProbes = unique([
    ...input.functionModifiers,
    ...input.designShapeModifiers,
    ...input.specAttributes,
    ...input.variantNoise,
    ...input.uncertainTerms,
  ]).filter((item) => compact(item) !== compact(coreProduct));
  const blocked = new Set(blockedSingleProbes.map(compact));

  const primaryProbes: string[] = [];
  addProbe(primaryProbes, coreProduct, new Set());
  if (compact(identityAnchor) !== compact(coreProduct)) {
    addProbe(primaryProbes, identityAnchor, new Set());
  }

  const conditionalProbes: string[] = [];
  for (const modifier of input.functionModifiers) {
    if (compact(identityAnchor).includes(compact(modifier))) continue;
    addProbe(conditionalProbes, joinProbe(modifier, coreProduct), blocked);
  }
  for (const modifier of input.designShapeModifiers) {
    addProbe(conditionalProbes, joinProbe(modifier, coreProduct), blocked);
    if (compact(identityAnchor) !== compact(coreProduct)) {
      addProbe(conditionalProbes, joinProbe(modifier, identityAnchor), blocked);
    }
  }
  for (const attribute of input.specAttributes) {
    if (compact(identityAnchor).includes(compact(attribute))) continue;
    addProbe(conditionalProbes, joinProbe(attribute, coreProduct), blocked);
  }

  return {
    primaryProbes: unique(primaryProbes, 4),
    conditionalProbes: unique(conditionalProbes, 10),
    blockedSingleProbes,
  };
}

function identitySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: 1,
        maxItems: MAX_ITEMS,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "goodsKey",
            "cleanedSeed",
            "coreProduct",
            "identityAnchor",
            ...ROLE_KEYS,
            "confidence",
            "reasoning",
          ],
          properties: {
            goodsKey: { type: "string", minLength: 1, maxLength: 30 },
            cleanedSeed: { type: "string", minLength: 1, maxLength: 160 },
            coreProduct: { type: "string", minLength: 1, maxLength: 50 },
            identityAnchor: { type: "string", minLength: 1, maxLength: 80 },
            functionModifiers: {
              type: "array",
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            designShapeModifiers: {
              type: "array",
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            specAttributes: {
              type: "array",
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            variantNoise: {
              type: "array",
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            uncertainTerms: {
              type: "array",
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reasoning: { type: "string", minLength: 1, maxLength: 400 },
          },
        },
      },
    },
  };
}

function systemPrompt() {
  return [
    "당신은 한국 이커머스 검색어 엔진의 상품 정체성 분석기다.",
    "목표는 상품명을 띄어쓰기 단위로 무조건 쪼개는 것이 아니라, 이 상품이 실제로 무엇인지 먼저 구조화하는 것이다.",
    "입력 cleanedSeed에 실제로 존재하는 표현만 사용한다. 동의어, 새로운 재질, 기능, 용도, 브랜드를 발명하지 않는다.",
    "coreProduct는 '이 물건은 무엇인가?'에 답하는 가장 작고 명확한 상품명사다.",
    "identityAnchor는 coreProduct만으로 너무 넓을 때 상품 정체성을 유지하는 최소 구문이다. 기능·종류를 결정하는 수식어는 포함할 수 있지만 색상·옵션코드·단순 디자인 테마는 제외한다.",
    "functionModifiers는 흡착형, 반자동, 자수처럼 상품 타입·기능·구조를 의미 있게 좁히는 표현이다.",
    "designShapeModifiers는 곰돌이, 투구, 시바견처럼 캐릭터·형상·패턴·디자인 테마다. 이것들은 단독 상품명사가 아니다.",
    "specAttributes는 재질, 크기, 중량, 수량, 규격 같은 스펙이다.",
    "variantNoise는 핑크, 화이트, 실버그레이 같은 색상과 A형/B형/1번 같은 옵션·변형 식별자다.",
    "uncertainTerms는 위 역할로 자신 있게 분류하기 어려운 표현만 넣는다.",
    "각 배열은 서로 의미가 겹치지 않게 하고 coreProduct 자체를 modifier 배열에 반복하지 않는다.",
    "디자인어가 시장에서 유행할 가능성은 여기서 버리지 않는다. designShapeModifiers로 보존하고 실제 시장성은 다음 단계가 검증한다.",
    "예시1: '곰돌이 자수 반바지 B형' → coreProduct='반바지', identityAnchor='자수 반바지', functionModifiers=['자수'], designShapeModifiers=['곰돌이'], variantNoise=['B형'].",
    "예시2: '투구 골무 핑크' → coreProduct='골무', identityAnchor='골무', designShapeModifiers=['투구'], variantNoise=['핑크'].",
    "confidence는 이 구조화가 얼마나 명확한지 0~1로 표시한다.",
  ].join("\n");
}

function extractOpenAiOutputText(payload: OpenAiResponse) {
  const direct = text(payload.output_text);
  if (direct) return direct;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && text(content.text)) return text(content.text);
    }
  }
  return "";
}

function sanitizeRawResult(
  raw: Record<string, unknown>,
  input: KeywordEngineIdentityInput,
  model: string,
): KeywordEngineIdentityResult {
  const cleanedSeed = text(input.cleanedSeed);
  const coreProductCandidate = text(raw.coreProduct);
  if (!coreProductCandidate || !isGrounded(coreProductCandidate, cleanedSeed)) {
    throw new Error(`${input.goodsKey}: 상품 핵심명사가 원 Seed에 근거하지 않습니다.`);
  }

  const coreProduct = coreProductCandidate;
  const anchorCandidate = text(raw.identityAnchor);
  const identityAnchor =
    anchorCandidate && isGrounded(anchorCandidate, cleanedSeed)
      ? anchorCandidate
      : coreProduct;

  const functionModifiers = groundedList(raw.functionModifiers, cleanedSeed).filter(
    (item) => compact(item) !== compact(coreProduct),
  );
  const used = new Set(functionModifiers.map(compact));
  const takeDisjoint = (value: unknown) => {
    const items = groundedList(value, cleanedSeed).filter(
      (item) => compact(item) !== compact(coreProduct) && !used.has(compact(item)),
    );
    for (const item of items) used.add(compact(item));
    return items;
  };
  const designShapeModifiers = takeDisjoint(raw.designShapeModifiers);
  const specAttributes = takeDisjoint(raw.specAttributes);
  const variantNoise = takeDisjoint(raw.variantNoise);
  const uncertainTerms = takeDisjoint(raw.uncertainTerms);

  const probes = buildKeywordIdentityProbes({
    coreProduct,
    identityAnchor,
    functionModifiers,
    designShapeModifiers,
    specAttributes,
    variantNoise,
    uncertainTerms,
  });
  const confidenceRaw = Number(raw.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0;

  return {
    goodsKey: input.goodsKey,
    cleanedSeed,
    coreProduct,
    identityAnchor,
    functionModifiers,
    designShapeModifiers,
    specAttributes,
    variantNoise,
    uncertainTerms,
    ...probes,
    confidence,
    reasoning: text(raw.reasoning).slice(0, 400),
    model,
    classifier: "openai_semantic_identity_v2",
    probePolicy:
      "Primary=core_product+identity_anchor / Conditional=function·design·spec를 core와 결합 / modifier·option 단독 probe 차단",
    warning: confidence < 0.65 ? "IDENTITY_LOW_CONFIDENCE" : "",
  };
}

export async function analyzeKeywordEngineIdentityBatch(
  inputs: KeywordEngineIdentityInput[],
  options: {
    apiKey?: string;
    model?: string;
    fetcher?: OpenAiFetch;
    timeoutMs?: number;
  } = {},
) {
  const normalizedInputs = inputs
    .map((item) => ({ goodsKey: text(item.goodsKey), cleanedSeed: text(item.cleanedSeed) }))
    .filter((item) => item.goodsKey && item.cleanedSeed)
    .slice(0, MAX_ITEMS);
  if (!normalizedInputs.length) throw new Error("STEP 4에서 분석할 정제 Seed가 없습니다.");

  const apiKey = text(options.apiKey ?? process.env.KEYWORD_ENGINE_OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않아 STEP 4 상품 정체성 분석을 실행할 수 없습니다.");
  }
  const model = text(
    options.model ??
      process.env.OPENAI_KEYWORD_IDENTITY_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-5-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 50_000);

  try {
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 3600,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt() }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(
                  {
                    task: "6개 이하 상품의 상품 정체성 역할 분류",
                    products: normalizedInputs,
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "keyword_engine_identity_analysis",
            description: "Grounded semantic product-identity decomposition for keyword probe generation.",
            strict: true,
            schema: identitySchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      throw new Error(
        text(payload.error?.message) || `OpenAI 상품 정체성 분석 요청 실패 · HTTP ${response.status}`,
      );
    }
    const outputText = extractOpenAiOutputText(payload);
    if (!outputText) throw new Error("STEP 4 AI 응답에서 구조화 결과를 찾지 못했습니다.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new Error("STEP 4 AI 응답 JSON을 읽지 못했습니다.");
    }
    const rawResults =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).results
        : [];
    if (!Array.isArray(rawResults)) throw new Error("STEP 4 AI 결과 배열이 없습니다.");

    const rawByGoodsKey = new Map<string, Record<string, unknown>>();
    for (const raw of rawResults) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const goodsKey = text(row.goodsKey);
      if (goodsKey) rawByGoodsKey.set(goodsKey, row);
    }

    const results = normalizedInputs.map((input) => {
      const raw = rawByGoodsKey.get(input.goodsKey);
      if (!raw) throw new Error(`${input.goodsKey}: STEP 4 AI 결과가 누락됐습니다.`);
      return sanitizeRawResult(raw, input, model);
    });

    return { model, results, analyzedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
  }
}
