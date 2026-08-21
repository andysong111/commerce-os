export type ProductLaunchAiTitleTermCategory =
  | "상품대체어"
  | "사용상황"
  | "형태구성"
  | "스타일"
  | "사용대상"
  | "중립수식어";

export type ProductLaunchAiTitleTerm = {
  text: string;
  category: ProductLaunchAiTitleTermCategory;
  reason: string;
  evidence: string[];
};

export type ProductLaunchAiTitleTermInput = {
  goodsKey: string;
  productGroup: string;
  originalTitle: string;
  currentTitleCandidates: string[];
  searchKeywords: string[];
  recommendationKeywords: string[];
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

const TERM_CATEGORIES: ProductLaunchAiTitleTermCategory[] = [
  "상품대체어",
  "사용상황",
  "형태구성",
  "스타일",
  "사용대상",
  "중립수식어",
];

const FORBIDDEN_PATTERNS = [
  /최고|최상|최강|완벽|혁신|기적|필수템|인생템/i,
  /최저가|무료배송|당일배송|특가|할인|정품/i,
  /치료|예방|개선|완화|효능|효과|교정|재활|살균|항균/i,
  /인증|kc|식약처|특허|국산|국내산|친환경/i,
  /100\s*%|무조건|영구|절대/i,
];

const SAFE_DERIVED_ROOTS: Array<{
  source: RegExp;
  generated: string[];
}> = [
  { source: /여행/, generated: ["휴대"] },
  { source: /휴대/, generated: ["여행"] },
  { source: /브러시|브러쉬/, generated: ["솔"] },
  { source: /솔/, generated: ["브러시", "브러쉬"] },
  { source: /거치대|거치/, generated: ["홀더"] },
  { source: /홀더/, generated: ["거치", "거치대"] },
  { source: /수납/, generated: ["정리", "보관"] },
  { source: /정리|보관/, generated: ["수납"] },
  { source: /운동화/, generated: ["스니커즈", "슈즈"] },
  { source: /스니커즈|슈즈/, generated: ["운동화"] },
];

const SAFE_TITLE_AFFIXES = ["형", "용", "식", "형태", "타입", "전용", "겸용"];

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return text(value)
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLocaleLowerCase();
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function uniqueTerms(values: unknown, limit = 30) {
  const source = Array.isArray(values) ? values : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of source) {
    const normalized = text(value);
    const identity = compact(normalized);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    result.push(normalized.slice(0, 80));
    if (result.length >= limit) break;
  }
  return result;
}

export function parseProductLaunchAiTitleTermInput(
  value: unknown,
): ProductLaunchAiTitleTermInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI 상품명 생성 요청 형식이 올바르지 않습니다.");
  }
  const source = value as Record<string, unknown>;
  const goodsKey = text(source.goods_key ?? source.goodsKey);
  if (!/^\d+$/.test(goodsKey)) {
    throw new Error("AI 상품명 생성에 올바른 goods_key가 필요합니다.");
  }
  const originalTitle = text(source.original_title ?? source.originalTitle);
  if (!originalTitle) {
    throw new Error("AI 생성어의 기준이 될 기존 상품명이 필요합니다.");
  }
  if (utf8Bytes(originalTitle) > 500) {
    throw new Error("기존 상품명이 너무 깁니다.");
  }
  return {
    goodsKey,
    productGroup: text(source.product_group ?? source.productGroup).slice(0, 80),
    originalTitle,
    currentTitleCandidates: uniqueTerms(
      source.current_title_candidates ?? source.currentTitleCandidates,
      30,
    ),
    searchKeywords: uniqueTerms(
      source.search_keywords ?? source.searchKeywords,
      20,
    ),
    recommendationKeywords: uniqueTerms(
      source.recommendation_keywords ?? source.recommendationKeywords,
      30,
    ),
  };
}

function sourceEvidenceText(input: ProductLaunchAiTitleTermInput) {
  return [
    input.originalTitle,
    input.productGroup,
    ...input.currentTitleCandidates,
    ...input.searchKeywords,
    ...input.recommendationKeywords,
  ]
    .filter(Boolean)
    .join(" | ");
}

function lexicalTokens(value: unknown) {
  return text(value).match(/[0-9A-Za-z가-힣]+/g) ?? [];
}

function markSpan(coverage: boolean[], start: number, length: number) {
  for (let index = start; index < start + length; index += 1) {
    if (index >= 0 && index < coverage.length) coverage[index] = true;
  }
}

function markSourceOverlap(
  token: string,
  sourceTokens: string[],
  coverage: boolean[],
) {
  for (const sourceToken of sourceTokens) {
    if (sourceToken.length < 2) continue;
    for (let start = 0; start < token.length; start += 1) {
      let bestLength = 0;
      for (let end = start + 2; end <= token.length; end += 1) {
        const fragment = token.slice(start, end);
        if (sourceToken.includes(fragment)) bestLength = fragment.length;
      }
      if (bestLength >= 2) markSpan(coverage, start, bestLength);
    }
  }
}

function markSafeDerivedRoots(
  token: string,
  sourceCompact: string,
  coverage: boolean[],
) {
  for (const rule of SAFE_DERIVED_ROOTS) {
    if (!rule.source.test(sourceCompact)) continue;
    for (const generatedRoot of rule.generated) {
      let start = token.indexOf(generatedRoot);
      while (start >= 0) {
        markSpan(coverage, start, generatedRoot.length);
        start = token.indexOf(generatedRoot, start + generatedRoot.length);
      }
    }
  }
}

function markSafeAffixes(token: string, coverage: boolean[]) {
  for (const affix of SAFE_TITLE_AFFIXES) {
    if (!token.endsWith(affix) || token.length <= affix.length) continue;
    const start = token.length - affix.length;
    if (coverage.slice(0, start).some(Boolean)) {
      markSpan(coverage, start, affix.length);
    }
  }
}

export function isProductLaunchAiTitleTermGrounded(
  generatedText: string,
  input: ProductLaunchAiTitleTermInput,
) {
  const sourceText = sourceEvidenceText(input);
  const sourceCompact = compact(sourceText);
  const sourceTokens = lexicalTokens(sourceText)
    .map(compact)
    .filter((token) => token.length >= 2);
  const generatedTokens = lexicalTokens(generatedText)
    .map(compact)
    .filter(Boolean);
  if (!generatedTokens.length) return false;

  return generatedTokens.every((token) => {
    if (token.length < 2) return true;
    const coverage = Array.from({ length: token.length }, () => false);
    if (sourceCompact.includes(token)) {
      coverage.fill(true);
    } else {
      markSourceOverlap(token, sourceTokens, coverage);
      markSafeDerivedRoots(token, sourceCompact, coverage);
      markSafeAffixes(token, coverage);
    }
    return coverage.every(Boolean);
  });
}

function cleanGeneratedTerm(value: unknown) {
  return text(value)
    .replace(/[,，、;|/]+/g, " ")
    .replace(/^[\[\]{}()'"`·•\-]+|[\[\]{}()'"`·•\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isForbiddenTerm(value: string) {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(value));
}

export function sanitizeProductLaunchAiTitleTerms(
  rawTerms: unknown,
  input: ProductLaunchAiTitleTermInput,
) {
  const source = Array.isArray(rawTerms) ? rawTerms : [];
  const evidenceSource = compact(sourceEvidenceText(input));
  const existing = new Set(
    [
      ...input.currentTitleCandidates,
      ...input.searchKeywords,
      ...input.recommendationKeywords,
    ].map(compact),
  );
  const seen = new Set<string>();
  const terms: ProductLaunchAiTitleTerm[] = [];
  let rejectedCount = 0;

  for (const raw of source) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      rejectedCount += 1;
      continue;
    }
    const row = raw as Record<string, unknown>;
    const generatedText = cleanGeneratedTerm(row.text);
    const identity = compact(generatedText);
    if (
      !identity ||
      identity.length < 2 ||
      generatedText.length > 20 ||
      utf8Bytes(generatedText) > 45 ||
      isForbiddenTerm(generatedText) ||
      !isProductLaunchAiTitleTermGrounded(generatedText, input) ||
      existing.has(identity) ||
      seen.has(identity)
    ) {
      rejectedCount += 1;
      continue;
    }

    const evidence = uniqueTerms(row.evidence, 3).filter((item) => {
      const key = compact(item);
      return key.length >= 2 && evidenceSource.includes(key);
    });
    if (!evidence.length) {
      rejectedCount += 1;
      continue;
    }

    const category = TERM_CATEGORIES.includes(
      row.category as ProductLaunchAiTitleTermCategory,
    )
      ? (row.category as ProductLaunchAiTitleTermCategory)
      : "중립수식어";
    seen.add(identity);
    terms.push({
      text: generatedText,
      category,
      reason: text(row.reason).slice(0, 120),
      evidence,
    });
    if (terms.length >= 16) break;
  }

  return { terms, rejectedCount };
}

function extractOpenAiOutputText(payload: OpenAiResponse) {
  const direct = text(payload.output_text);
  if (direct) return direct;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && text(content.text)) {
        return text(content.text);
      }
    }
  }
  return "";
}

function titleTermSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["terms"],
    properties: {
      terms: {
        type: "array",
        minItems: 10,
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "category", "reason", "evidence"],
          properties: {
            text: { type: "string", minLength: 2, maxLength: 20 },
            category: { type: "string", enum: TERM_CATEGORIES },
            reason: { type: "string", minLength: 1, maxLength: 120 },
            evidence: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: { type: "string", minLength: 1, maxLength: 60 },
            },
          },
        },
      },
    },
  };
}

function systemPrompt() {
  return [
    "당신은 한국 이커머스 상품명 편집자다.",
    "목표는 동일 상품을 여러 마켓에서 서로 다른 자연스러운 상품명으로 조합할 때 사용할 짧은 단어 또는 짧은 구문을 만드는 것이다.",
    "검색어를 만드는 작업이 아니므로 자연스러운 띄어쓰기를 사용할 수 있다.",
    "제공된 상품명, 상품그룹, 검색어, 추천키워드가 증명하는 상품 정체성 안에서만 생성한다.",
    "새로운 브랜드, 재질, 색상, 크기, 수량, 원산지, 인증, 기능, 효능, 의료 표현을 추측하지 않는다.",
    "생성어에 포함되는 모든 핵심 단어와 수식어는 입력 데이터에서 직접 확인되거나, 여행용-휴대형처럼 의미가 보수적으로 동일한 표현이어야 한다.",
    "최고, 완벽, 필수템, 최저가, 무료배송 같은 과장·가격·배송 표현을 만들지 않는다.",
    "각 생성어는 상품명 조합 부품으로 바로 쓸 수 있게 2~20자 이내로 간결하게 만든다.",
    "이미 제공된 상품명 후보와 동일하거나 단순 어순 변경인 표현은 피한다.",
    "evidence에는 반드시 입력 데이터에 실제로 존재하는 단어 또는 구문을 그대로 적는다.",
  ].join("\n");
}

function userPrompt(input: ProductLaunchAiTitleTermInput) {
  return JSON.stringify(
    {
      task: "상품명 다양화용 AI 생성어 10~16개 생성",
      goods_key: input.goodsKey,
      product_group: input.productGroup,
      original_title: input.originalTitle,
      current_title_candidates: input.currentTitleCandidates,
      search_keywords: input.searchKeywords,
      recommendation_keywords: input.recommendationKeywords,
    },
    null,
    2,
  );
}

export async function generateProductLaunchAiTitleTerms(
  inputValue: unknown,
  options: {
    apiKey?: string;
    model?: string;
    fetcher?: OpenAiFetch;
    timeoutMs?: number;
  } = {},
) {
  const input = parseProductLaunchAiTitleTermInput(inputValue);
  const apiKey = text(options.apiKey ?? process.env.PRODUCT_TITLE_OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY가 설정되지 않아 AI 상품명 생성어를 만들 수 없습니다.",
    );
  }
  const model = text(
    options.model ??
      process.env.OPENAI_TITLE_TERM_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-5-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 45_000,
  );

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
        max_output_tokens: 1800,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt() }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt(input) }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "product_launch_title_terms",
            description:
              "Safe Korean product-title building blocks grounded in the supplied product context.",
            strict: true,
            schema: titleTermSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      throw new Error(
        text(payload.error?.message) ||
          `OpenAI API 요청이 실패했습니다. HTTP ${response.status}`,
      );
    }
    const outputText = extractOpenAiOutputText(payload);
    if (!outputText) {
      throw new Error("OpenAI 응답에서 AI 생성어 결과를 찾지 못했습니다.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new Error("OpenAI AI 생성어 응답 JSON을 읽지 못했습니다.");
    }
    const rawTerms =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).terms
        : [];
    const sanitized = sanitizeProductLaunchAiTitleTerms(rawTerms, input);
    if (!sanitized.terms.length) {
      throw new Error(
        "상품 근거를 확인할 수 있는 안전한 AI 생성어가 나오지 않았습니다. 상품명이나 추천키워드를 보완한 뒤 다시 실행하세요.",
      );
    }
    return {
      status: "success" as const,
      goodsKey: input.goodsKey,
      model,
      terms: sanitized.terms,
      rejectedCount: sanitized.rejectedCount,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}
