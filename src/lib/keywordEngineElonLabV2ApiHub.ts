import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonCanonical,
  type KeywordElonIdentity,
  type KeywordElonMarketEvidence,
} from "@/lib/keywordEngineElonLabV2";

const API_HUB_BASE = "https://naverapihub.apigw.ntruss.com";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const SEARCH_DISPLAY = 20;
const SEARCH_QUERY_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const EVIDENCE_TIMEOUT_MS = 28_000;
const EVIDENCE_DOC_LIMIT = 80;
const MARKET_TERM_LIMIT = 80;
const DEFAULT_MODEL = "gpt-5-mini";

const SEARCH_ENDPOINTS = [
  { name: "kin", path: "/search/v1/kin", weight: 6 },
  { name: "cafe", path: "/search/v1/cafearticle", weight: 5 },
  { name: "blog", path: "/search/v1/blog", weight: 3 },
  { name: "web", path: "/search/v1/webkr", weight: 1 },
] as const;

const STOPWORDS = new Set([
  "네이버", "블로그", "카페", "지식인", "후기", "리뷰", "추천", "정보", "방법", "사용", "사용법", "제품", "상품",
  "구매", "판매", "가격", "무료배송", "배송", "정품", "할인", "특가", "세일", "신상품", "인기", "최저가",
  "오늘", "이번", "관련", "대한", "위한", "있는", "없는", "좋은", "좋아요", "합니다", "입니다", "그리고", "하지만",
  "색상", "블랙", "화이트", "핑크", "그레이", "브라운", "베이지", "사이즈", "대형", "소형", "중형", "세트", "단품",
]);

type ApiHubItem = { title?: unknown; description?: unknown };
type ApiHubPayload = { items?: ApiHubItem[] };
type OpenAiPayload = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  error?: { message?: unknown };
};

type MarketDocument = {
  id: number;
  source: string;
  query: string;
  title: string;
  description: string;
};

export type KeywordElonApiHubMarketTerm = KeywordElonMarketEvidence;

export type KeywordElonApiHubMarketMine = {
  configured: boolean;
  queries: string[];
  documents: MarketDocument[];
  terms: KeywordElonApiHubMarketTerm[];
  activeSources: string[];
  warnings: string[];
};

function credentials() {
  const clientId = normalizeKeywordElonText(process.env.NAVER_API_HUB_CLIENT_ID);
  const clientSecret = normalizeKeywordElonText(process.env.NAVER_API_HUB_CLIENT_SECRET);
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

function openAiModel() {
  return (
    normalizeKeywordElonText(process.env.OPENAI_KEYWORD_ELON_MODEL) ||
    normalizeKeywordElonText(process.env.OPENAI_KEYWORD_IDENTITY_MODEL) ||
    normalizeKeywordElonText(process.env.OPENAI_MODEL) ||
    DEFAULT_MODEL
  );
}

function outputText(payload: OpenAiPayload) {
  const direct = normalizeKeywordElonText(payload.output_text);
  if (direct) return direct;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && normalizeKeywordElonText(content.text)) return normalizeKeywordElonText(content.text);
    }
  }
  return "";
}

function stripHtml(value: unknown) {
  return normalizeKeywordElonText(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanToken(value: string) {
  return value.replace(/^[^0-9A-Za-z가-힣]+|[^0-9A-Za-z가-힣]+$/g, "");
}

function titleTokens(value: string) {
  return stripHtml(value)
    .replace(/[\[\](){}<>|/\\,.:;!?~^*_+=·•▶▷→←]+/g, " ")
    .split(/\s+/)
    .map(cleanToken)
    .map(compactKeywordElonKey)
    .filter((token) => token.length >= 2 && token.length <= 14 && !/^\d+$/.test(token) && !STOPWORDS.has(token));
}

function chooseQueries(identity: KeywordElonIdentity, bridgeSeeds: string[]) {
  return uniqueKeywordElonCanonical([
    ...bridgeSeeds,
    identity.coreProduct,
    ...identity.primarySeeds,
    ...identity.conditionalSeeds,
  ], 40)
    .filter((value) => value.length >= 2 && value.length <= 12)
    .sort((a, b) => a.length - b.length)
    .slice(0, SEARCH_QUERY_LIMIT);
}

function permissionWarning(source: string, status: number, raw: string) {
  const compact = raw.replace(/\s+/g, " ").slice(0, 180);
  if (status === 401 && /활성화|Application|API/i.test(compact)) {
    return `API_HUB_${source.toUpperCase()}_PERMISSION_REQUIRED: NAVER API HUB Application에서 ${source} 검색 API를 활성화해 주세요.`;
  }
  return `API_HUB_${source.toUpperCase()}_HTTP_${status}:${compact}`;
}

async function fetchSearch(source: (typeof SEARCH_ENDPOINTS)[number], query: string) {
  const auth = credentials();
  if (!auth.configured) return { documents: [] as Omit<MarketDocument, "id">[], warning: "API_HUB_NOT_CONFIGURED" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = new URL(`${API_HUB_BASE}${source.path}`);
    url.searchParams.set("query", query);
    url.searchParams.set("display", String(SEARCH_DISPLAY));
    url.searchParams.set("start", "1");
    url.searchParams.set("sort", "sim");
    url.searchParams.set("format", "json");
    const response = await fetch(url, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": auth.clientId,
        "X-NCP-APIGW-API-KEY": auth.clientSecret,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    if (!response.ok) {
      return { documents: [] as Omit<MarketDocument, "id">[], warning: permissionWarning(source.name, response.status, raw) };
    }
    let payload: ApiHubPayload = {};
    try {
      payload = JSON.parse(raw) as ApiHubPayload;
    } catch {
      return { documents: [] as Omit<MarketDocument, "id">[], warning: `API_HUB_${source.name.toUpperCase()}_INVALID_JSON` };
    }
    const documents = (payload.items ?? []).map((item) => ({
      source: source.name,
      query,
      title: stripHtml(item.title),
      description: stripHtml(item.description),
    })).filter((item) => item.title || item.description);
    return { documents, warning: "" };
  } catch (error) {
    const warning = error instanceof Error && error.name === "AbortError"
      ? `API_HUB_${source.name.toUpperCase()}_TIMEOUT`
      : `API_HUB_${source.name.toUpperCase()}_FAILED:${error instanceof Error ? error.message : String(error)}`;
    return { documents: [] as Omit<MarketDocument, "id">[], warning };
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackEvidenceTerms(documents: MarketDocument[], queries: string[]) {
  const queryKeys = new Set(queries.map(compactKeywordElonKey));
  const stats = new Map<string, { documents: Set<number>; titleDocuments: Set<number>; sources: Set<string> }>();
  for (const doc of documents) {
    const tokens = titleTokens(doc.title);
    const terms = [...tokens];
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      const joined = compactKeywordElonKey(`${tokens[index]}${tokens[index + 1]}`);
      if (joined.length >= 3 && joined.length <= 14) terms.push(joined);
    }
    for (const term of new Set(terms)) {
      if (!term || queryKeys.has(term)) continue;
      const row = stats.get(term) ?? { documents: new Set<number>(), titleDocuments: new Set<number>(), sources: new Set<string>() };
      row.documents.add(doc.id);
      row.titleDocuments.add(doc.id);
      row.sources.add(doc.source);
      stats.set(term, row);
    }
  }
  return [...stats.entries()]
    .map(([term, row]) => {
      const sourceWeight = [...row.sources].reduce((sum, source) => sum + (SEARCH_ENDPOINTS.find((item) => item.name === source)?.weight ?? 1), 0);
      const evidenceCount = row.documents.size;
      return {
        term,
        score: evidenceCount * 5 + row.sources.size * 8 + sourceWeight,
        documentCount: evidenceCount,
        titleCount: row.titleDocuments.size,
        sourceCount: row.sources.size,
        sources: [...row.sources].sort(),
        kind: "title_evidence",
        evidenceCount,
      } satisfies KeywordElonApiHubMarketTerm;
    })
    .filter((row) => row.documentCount >= 2 || row.sourceCount >= 2)
    .sort((a, b) => b.score - a.score || a.term.length - b.term.length)
    .slice(0, MARKET_TERM_LIMIT);
}

function evidenceSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["terms"],
    properties: {
      terms: {
        type: "array",
        minItems: 0,
        maxItems: 24,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["term", "kind", "evidenceIds"],
          properties: {
            term: { type: "string", minLength: 2, maxLength: 30 },
            kind: { type: "string", enum: ["alias", "product_term", "need_term"] },
            evidenceIds: { type: "array", minItems: 1, maxItems: 12, items: { type: "integer", minimum: 1 } },
          },
        },
      },
    },
  };
}

async function extractEvidenceTerms(identity: KeywordElonIdentity, bridgeSeeds: string[], documents: MarketDocument[]) {
  const apiKey = normalizeKeywordElonText((process.env.KEYWORD_ENGINE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY));
  if (!apiKey || documents.length === 0) return { terms: [] as KeywordElonApiHubMarketTerm[], warning: apiKey ? "" : "API_HUB_EVIDENCE_AI_NOT_CONFIGURED" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EVIDENCE_TIMEOUT_MS);
  try {
    const evidenceDocs = documents.slice(0, EVIDENCE_DOC_LIMIT).map((doc) => ({
      id: doc.id,
      source: doc.source,
      query: doc.query,
      title: doc.title.slice(0, 140),
      description: doc.description.slice(0, 180),
    }));
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: openAiModel(),
        store: false,
        max_output_tokens: 1_800,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 한국 소비자 시장어 Evidence Miner다.",
                "새 단어를 발명하지 말고 제공된 지식iN·카페·블로그·웹 문서에 실제로 나타나거나 문맥상 명확히 지칭되는 상품명/속칭/욕구어만 추출한다.",
                "제조사식 긴 설명문보다 실제 검색창에 입력할 짧은 명사형 표현을 우선한다.",
                "각 term에는 반드시 근거 document id를 넣는다. 근거가 약하면 반환하지 않는다.",
                "색상·규격·판매문구·브랜드·효능을 임의로 만들지 않는다.",
                "동일한 뜻의 띄어쓰기 변형은 하나만 반환하고 term은 가능하면 공백 없이 쓴다.",
                "최대 24개만 반환한다.",
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                productIdentity: identity.koreanProductIdentity,
                coreProduct: identity.coreProduct,
                bridgeSeeds,
                documents: evidenceDocs,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "keyword_elon_market_evidence_v6",
            strict: true,
            schema: evidenceSchema(),
          },
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let payload: OpenAiPayload = {};
    try { payload = JSON.parse(raw) as OpenAiPayload; } catch { return { terms: [] as KeywordElonApiHubMarketTerm[], warning: "API_HUB_EVIDENCE_INVALID_JSON" }; }
    if (!response.ok) return { terms: [] as KeywordElonApiHubMarketTerm[], warning: `API_HUB_EVIDENCE_HTTP_${response.status}:${normalizeKeywordElonText(payload.error?.message)}` };
    if (normalizeKeywordElonText(payload.status) === "incomplete") return { terms: [] as KeywordElonApiHubMarketTerm[], warning: `API_HUB_EVIDENCE_INCOMPLETE:${normalizeKeywordElonText(payload.incomplete_details?.reason) || "unknown"}` };
    const text = outputText(payload);
    if (!text) return { terms: [] as KeywordElonApiHubMarketTerm[], warning: "API_HUB_EVIDENCE_EMPTY" };
    let parsed: { terms?: Array<{ term?: unknown; kind?: unknown; evidenceIds?: unknown }> } = {};
    try { parsed = JSON.parse(text) as typeof parsed; } catch { return { terms: [] as KeywordElonApiHubMarketTerm[], warning: "API_HUB_EVIDENCE_PARSE_FAILED" }; }
    const byId = new Map(documents.map((doc) => [doc.id, doc]));
    const rows: KeywordElonApiHubMarketTerm[] = [];
    const seen = new Set<string>();
    for (const item of parsed.terms ?? []) {
      const term = compactKeywordElonKey(item.term);
      if (term.length < 2 || term.length > 14 || seen.has(term)) continue;
      const ids = Array.isArray(item.evidenceIds) ? [...new Set(item.evidenceIds.map(Number).filter((id) => Number.isInteger(id) && byId.has(id)))] : [];
      if (!ids.length) continue;
      const sourceSet = new Set(ids.map((id) => byId.get(id)?.source).filter((value): value is string => Boolean(value)));
      const titleCount = ids.filter((id) => titleTokens(byId.get(id)?.title ?? "").includes(term)).length;
      const sourceWeight = [...sourceSet].reduce((sum, source) => sum + (SEARCH_ENDPOINTS.find((entry) => entry.name === source)?.weight ?? 1), 0);
      const kind = normalizeKeywordElonText(item.kind) || "product_term";
      const score = ids.length * 10 + sourceSet.size * 12 + sourceWeight + (kind === "alias" ? 8 : kind === "product_term" ? 5 : 2);
      rows.push({ term, score, documentCount: ids.length, titleCount, sourceCount: sourceSet.size, sources: [...sourceSet].sort(), kind, evidenceCount: ids.length });
      seen.add(term);
    }
    return { terms: rows.sort((a, b) => b.score - a.score || a.term.length - b.term.length).slice(0, MARKET_TERM_LIMIT), warning: "" };
  } catch (error) {
    const warning = error instanceof Error && error.name === "AbortError"
      ? "API_HUB_EVIDENCE_TIMEOUT"
      : `API_HUB_EVIDENCE_FAILED:${error instanceof Error ? error.message : String(error)}`;
    return { terms: [] as KeywordElonApiHubMarketTerm[], warning };
  } finally {
    clearTimeout(timeout);
  }
}

export async function mineKeywordElonApiHubMarket(identity: KeywordElonIdentity, bridgeSeeds: string[]): Promise<KeywordElonApiHubMarketMine> {
  const auth = credentials();
  const queries = chooseQueries(identity, bridgeSeeds);
  if (!auth.configured) {
    return {
      configured: false,
      queries,
      documents: [],
      terms: [],
      activeSources: [],
      warnings: ["NAVER API HUB 광산 미연결 · NAVER_API_HUB_CLIENT_ID / NAVER_API_HUB_CLIENT_SECRET 필요"],
    };
  }

  const rawDocuments: Omit<MarketDocument, "id">[] = [];
  const warnings: string[] = [];
  for (const query of queries) {
    const results = await Promise.all(SEARCH_ENDPOINTS.map((source) => fetchSearch(source, query)));
    for (const result of results) {
      rawDocuments.push(...result.documents);
      if (result.warning) warnings.push(result.warning);
    }
  }
  const deduped = new Map<string, Omit<MarketDocument, "id">>();
  for (const doc of rawDocuments) {
    const key = `${doc.source}:${compactKeywordElonKey(doc.title)}:${compactKeywordElonKey(doc.description).slice(0, 80)}`;
    if (!deduped.has(key)) deduped.set(key, doc);
  }
  const documents = [...deduped.values()].map((doc, index) => ({ ...doc, id: index + 1 }));
  const activeSources = [...new Set(documents.map((doc) => doc.source))];
  const evidence = await extractEvidenceTerms(identity, bridgeSeeds, documents);
  const fallback = evidence.terms.length ? [] : fallbackEvidenceTerms(documents, queries);
  const terms = evidence.terms.length ? evidence.terms : fallback;
  const finalWarnings = [...new Set([...warnings, evidence.warning].filter(Boolean))].slice(0, 20);
  if (documents.length && !evidence.terms.length && fallback.length) finalWarnings.push("API_HUB_EVIDENCE_FALLBACK_USED: AI Evidence Miner 대신 반복 제목 증거를 사용했습니다.");
  return {
    configured: true,
    queries,
    documents,
    terms,
    activeSources,
    warnings: [...new Set(finalWarnings)].slice(0, 20),
  };
}

export function keywordElonApiHubConfigured() {
  return credentials().configured;
}
