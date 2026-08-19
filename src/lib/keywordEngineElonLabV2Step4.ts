import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonIdentity,
} from "@/lib/keywordEngineElonLabV2";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 35_000;
const AI_RISK_BATCH_SIZE = 60;
const KIPRIS_TIMEOUT_MS = 10_000;
const KIPRIS_BATCH_SIZE = 4;
const KIPRIS_CHECK_LIMIT = 30;
const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_KIPRIS_TRADEMARK_ENDPOINT =
  "https://plus.kipris.or.kr/kipo-api/kipi/trademarkInfoSearchService/getWordSearch";

export type KeywordElonStep4RiskCategory =
  | "trademark"
  | "medical_device"
  | "pregnancy"
  | "baby"
  | "adult"
  | "custom";

export type KeywordElonStep4TrademarkMatch = {
  trademarkName: string;
  applicationNumber: string;
  registrationNumber: string;
  status: string;
};

export type KeywordElonStep4Decision = {
  keyword: string;
  searchKey: string;
  blocked: boolean;
  categories: KeywordElonStep4RiskCategory[];
  reasons: string[];
  matchedTerms: string[];
  trademarkMatches: KeywordElonStep4TrademarkMatch[];
};

export type KeywordElonStep4FilterResult = {
  inputCount: number;
  allowedCount: number;
  removedCount: number;
  allowedKeys: string[];
  removedKeys: string[];
  decisions: KeywordElonStep4Decision[];
  aiConfigured: boolean;
  kiprisConfigured: boolean;
  kiprisCheckedCount: number;
  kiprisMatchedCount: number;
  warnings: string[];
};

type OpenAiPayload = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  error?: { message?: unknown };
};

type AiRiskDecision = {
  keyword: string;
  blocked: boolean;
  categories: KeywordElonStep4RiskCategory[];
  confidence: number;
  reason: string;
};

type KiprisCheck = {
  keyword: string;
  checked: boolean;
  matches: KeywordElonStep4TrademarkMatch[];
  warning: string;
};

const BUILTIN_RISK_TERMS: Record<Exclude<KeywordElonStep4RiskCategory, "trademark" | "custom">, string[]> = {
  medical_device: [
    "의료기기", "의료용", "치료용", "치료기", "치료", "진단기", "진단", "처방", "수술용", "재활",
    "통증완화", "혈압", "혈당", "산소포화도", "심전도", "체온계", "보청기", "환자용", "교정치료",
    "교정기", "비염치료", "코골이치료", "질병", "완치", "치유",
  ],
  pregnancy: [
    "임산부", "임부", "임신", "산모", "출산", "산후", "태교", "수유", "모유", "배란", "난임", "태아", "만삭",
  ],
  baby: [
    "유아용품", "아기용품", "육아용품", "신생아", "영아", "유아", "아기", "베이비", "키즈", "어린이용",
    "아동용", "젖병", "쪽쪽이",
  ],
  adult: [
    "성인용품", "성인장난감", "19금", "섹스토이", "자위", "오나홀", "딜도", "바이브레이터", "애널",
    "러브젤", "최음", "콘돔", "발기", "사정", "성기", "음경", "질세정", "bdsm", "sm용품",
  ],
};

const CATEGORY_REASON: Record<Exclude<KeywordElonStep4RiskCategory, "trademark" | "custom">, string> = {
  medical_device: "의료기기·치료·진단 표현",
  pregnancy: "임산부·임신·출산 관련 표현",
  baby: "유아·영아·아동용품 관련 표현",
  adult: "성인용품·성적 표현",
};

function openAiModel() {
  return (
    normalizeKeywordElonText(process.env.OPENAI_KEYWORD_ELON_MODEL)
    || normalizeKeywordElonText(process.env.OPENAI_KEYWORD_IDENTITY_MODEL)
    || normalizeKeywordElonText(process.env.OPENAI_MODEL)
    || DEFAULT_MODEL
  );
}

function outputText(payload: OpenAiPayload) {
  const direct = normalizeKeywordElonText(payload.output_text);
  if (direct) return direct;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && normalizeKeywordElonText(content.text)) {
        return normalizeKeywordElonText(content.text);
      }
    }
  }
  return "";
}

function aiRiskSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["decisions"],
    properties: {
      decisions: {
        type: "array",
        minItems: 0,
        maxItems: AI_RISK_BATCH_SIZE,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["keyword", "blocked", "categories", "confidence", "reason"],
          properties: {
            keyword: { type: "string", minLength: 1, maxLength: 60 },
            blocked: { type: "boolean" },
            categories: {
              type: "array",
              minItems: 0,
              maxItems: 4,
              items: { type: "string", enum: ["medical_device", "pregnancy", "baby", "adult"] },
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string", minLength: 1, maxLength: 180 },
          },
        },
      },
    },
  };
}

function parseAiRiskDecisions(value: unknown) {
  if (!value || typeof value !== "object") return [] as AiRiskDecision[];
  const parsed = value as { decisions?: unknown[] };
  const allowedCategories = new Set<KeywordElonStep4RiskCategory>([
    "medical_device", "pregnancy", "baby", "adult",
  ]);
  const decisions: AiRiskDecision[] = [];
  for (const rawDecision of parsed.decisions ?? []) {
    if (!rawDecision || typeof rawDecision !== "object") continue;
    const row = rawDecision as Record<string, unknown>;
    const keyword = normalizeKeywordElonText(row.keyword);
    if (!compactKeywordElonKey(keyword)) continue;
    const confidence = Math.max(0, Math.min(1, Number(row.confidence) || 0));
    const categories = Array.isArray(row.categories)
      ? row.categories
        .map((category) => normalizeKeywordElonText(category) as KeywordElonStep4RiskCategory)
        .filter((category) => allowedCategories.has(category))
      : [];
    decisions.push({
      keyword,
      blocked: Boolean(row.blocked) && confidence >= 0.82 && categories.length > 0,
      categories: [...new Set(categories)],
      confidence,
      reason: normalizeKeywordElonText(row.reason).slice(0, 180),
    });
  }
  return decisions;
}

async function classifySemanticRiskBatch(
  identity: KeywordElonIdentity,
  keywords: string[],
  apiKey: string,
  batchNumber: number,
): Promise<{ decisions: AiRiskDecision[]; warning: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: openAiModel(),
        store: false,
        max_output_tokens: 2_500,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 한국 이커머스 STEP 4 금지키워드 심사관이다.",
                "각 키워드 자체가 다음 위험영역을 직접 표방할 때만 차단한다: 의료기기·치료·진단, 임산부·임신·출산, 유아·영아·아동용품, 성인용품·성적 용도.",
                "일반 미용·생활용품을 의료기기로 추론하지 않는다. 단순히 '성인'이라는 말이 있다는 이유만으로 성인용품으로 분류하지 않는다.",
                "상표권은 여기서 판단하지 않는다. KIPRIS가 별도로 검사한다.",
                "애매하면 blocked=false로 두고, 직접적이고 명확한 경우만 confidence 0.82 이상으로 차단한다.",
                "원본에 없는 위험 용도를 새로 상상하지 않는다.",
                "입력된 모든 키워드에 대해 정확히 한 개의 decision을 반환한다.",
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                batchNumber,
                productIdentity: identity.koreanProductIdentity,
                coreProduct: identity.coreProduct,
                identityAnchor: identity.identityAnchor,
                keywords,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "keyword_elon_step4_risk_filter_v1",
            strict: true,
            schema: aiRiskSchema(),
          },
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const raw = await response.text();
    let payload: OpenAiPayload = {};
    try {
      payload = JSON.parse(raw) as OpenAiPayload;
    } catch {
      return { decisions: [], warning: `STEP4_AI_BATCH_${batchNumber}_INVALID_JSON` };
    }
    if (!response.ok) {
      return {
        decisions: [],
        warning: `STEP4_AI_BATCH_${batchNumber}_HTTP_${response.status}:${normalizeKeywordElonText(payload.error?.message)}`,
      };
    }
    if (normalizeKeywordElonText(payload.status) === "incomplete") {
      return {
        decisions: [],
        warning: `STEP4_AI_BATCH_${batchNumber}_INCOMPLETE:${normalizeKeywordElonText(payload.incomplete_details?.reason) || "unknown"}`,
      };
    }

    const responseText = outputText(payload);
    if (!responseText) return { decisions: [], warning: `STEP4_AI_BATCH_${batchNumber}_EMPTY` };
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText) as unknown;
    } catch {
      return { decisions: [], warning: `STEP4_AI_BATCH_${batchNumber}_PARSE_FAILED` };
    }
    const decisions = parseAiRiskDecisions(parsed);
    const returnedKeys = new Set(decisions.map((decision) => compactKeywordElonKey(decision.keyword)));
    const missingCount = keywords.filter((keyword) => !returnedKeys.has(compactKeywordElonKey(keyword))).length;
    return {
      decisions,
      warning: missingCount ? `STEP4_AI_BATCH_${batchNumber}_MISSING_DECISIONS:${missingCount}` : "",
    };
  } catch (error) {
    const warning = error instanceof Error && error.name === "AbortError"
      ? `STEP4_AI_BATCH_${batchNumber}_TIMEOUT`
      : `STEP4_AI_BATCH_${batchNumber}_FAILED:${error instanceof Error ? error.message : String(error)}`;
    return { decisions: [], warning };
  } finally {
    clearTimeout(timeout);
  }
}

async function classifySemanticRisks(
  identity: KeywordElonIdentity,
  keywords: string[],
): Promise<{ decisions: AiRiskDecision[]; warning: string; configured: boolean }> {
  const apiKey = normalizeKeywordElonText(process.env.OPENAI_API_KEY);
  if (!apiKey || !keywords.length) {
    return {
      decisions: [],
      warning: apiKey ? "" : "STEP4_AI_NOT_CONFIGURED",
      configured: Boolean(apiKey),
    };
  }

  const decisions: AiRiskDecision[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < keywords.length; index += AI_RISK_BATCH_SIZE) {
    const batchNumber = Math.floor(index / AI_RISK_BATCH_SIZE) + 1;
    const batch = keywords.slice(index, index + AI_RISK_BATCH_SIZE);
    const result = await classifySemanticRiskBatch(identity, batch, apiKey, batchNumber);
    decisions.push(...result.decisions);
    if (result.warning) warnings.push(result.warning);
  }
  return {
    decisions,
    warning: [...new Set(warnings)].join(" | "),
    configured: true,
  };
}

function decodePossibleEncodedKey(value: string) {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function kiprisSettings() {
  const rawAccessKey = normalizeKeywordElonText(
    process.env.KIPRISPLUS_ACCESS_KEY || process.env.KIPRIS_ACCESS_KEY,
  );
  const accessKey = decodePossibleEncodedKey(rawAccessKey);
  const endpoint = normalizeKeywordElonText(process.env.KIPRISPLUS_TRADEMARK_ENDPOINT)
    || DEFAULT_KIPRIS_TRADEMARK_ENDPOINT;
  return { accessKey, endpoint, configured: Boolean(accessKey) };
}

export function keywordElonKiprisConfigured() {
  return kiprisSettings().configured;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .trim();
}

function xmlField(block: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
    if (match?.[1]) return decodeXml(match[1].replace(/<[^>]+>/g, " "));
  }
  return "";
}

function clearlyInactiveTrademark(status: string) {
  return /(거절|취하|포기|무효|소멸|취소|말소|실효|abandon|reject|expire|cancel|invalid)/i.test(status);
}

function clearlyRegisteredTrademark(status: string, registrationNumber: string) {
  if (registrationNumber) return true;
  return /(등록|존속|유효|registered|active)/i.test(status);
}

function parseKiprisMatches(xml: string, keyword: string) {
  const itemBlocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const keywordKey = compactKeywordElonKey(keyword);
  const matches: KeywordElonStep4TrademarkMatch[] = [];

  for (const block of itemBlocks) {
    const trademarkName = xmlField(block, [
      "trademarkName", "trademarkNameName", "markName", "titleName", "trademarkNameKor", "trademarkNameEng",
    ]);
    const applicationNumber = xmlField(block, ["applicationNumber", "applicationNo", "appNumber"]);
    const registrationNumber = xmlField(block, [
      "registrationNumber", "registerNumber", "registrationNo", "regNumber",
    ]);
    const status = xmlField(block, [
      "applicationStatus", "registerStatus", "registrationStatus", "registrationStatusName", "legalStatus", "lastvalue",
    ]);
    const exact = Boolean(trademarkName) && compactKeywordElonKey(trademarkName) === keywordKey;
    const registered = clearlyRegisteredTrademark(status, registrationNumber);
    if (!exact || !registered || clearlyInactiveTrademark(status)) continue;
    matches.push({ trademarkName, applicationNumber, registrationNumber, status });
  }

  const seen = new Set<string>();
  return matches.filter((row) => {
    const key = `${compactKeywordElonKey(row.trademarkName)}|${row.applicationNumber}|${row.registrationNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function kiprisResultWarning(xml: string) {
  const resultCode = xmlField(xml, ["resultCode", "returnReasonCode", "errorCode"]);
  const resultMessage = xmlField(xml, ["resultMsg", "returnAuthMsg", "errorMessage"]);
  if (!resultCode || resultCode === "00" || resultCode === "20") return "";
  return `KIPRIS_RESULT_${resultCode}:${resultMessage || "unknown"}`;
}

async function checkKiprisTrademark(keyword: string): Promise<KiprisCheck> {
  const settings = kiprisSettings();
  if (!settings.configured) {
    return { keyword, checked: false, matches: [], warning: "KIPRIS_NOT_CONFIGURED" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KIPRIS_TIMEOUT_MS);
  try {
    const url = new URL(settings.endpoint);
    url.searchParams.set("ServiceKey", settings.accessKey);
    url.searchParams.set("searchString", keyword);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "30");
    url.searchParams.set("descSort", "true");
    url.searchParams.set("sortSpec", "AD");
    const response = await fetch(url, {
      headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.5" },
      signal: controller.signal,
      cache: "no-store",
    });
    const xml = await response.text();
    if (!response.ok) {
      return {
        keyword,
        checked: false,
        matches: [],
        warning: `KIPRIS_HTTP_${response.status}:${normalizeKeywordElonText(xml).slice(0, 160)}`,
      };
    }
    const resultWarning = kiprisResultWarning(xml);
    if (resultWarning) return { keyword, checked: false, matches: [], warning: resultWarning };
    return { keyword, checked: true, matches: parseKiprisMatches(xml, keyword), warning: "" };
  } catch (error) {
    const warning = error instanceof Error && error.name === "AbortError"
      ? "KIPRIS_TIMEOUT"
      : `KIPRIS_FAILED:${error instanceof Error ? error.message : String(error)}`;
    return { keyword, checked: false, matches: [], warning };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkKiprisBatch(keywords: string[]) {
  const results: KiprisCheck[] = [];
  for (let index = 0; index < keywords.length; index += KIPRIS_BATCH_SIZE) {
    const batch = keywords.slice(index, index + KIPRIS_BATCH_SIZE);
    results.push(...await Promise.all(batch.map(checkKiprisTrademark)));
  }
  return results;
}

function createDecision(row: KeywordElonCandidate): KeywordElonStep4Decision {
  const keyword = normalizeKeywordElonText(row.searchKeyword || row.searchKey || row.keyword);
  return {
    keyword,
    searchKey: compactKeywordElonKey(keyword),
    blocked: false,
    categories: [],
    reasons: [],
    matchedTerms: [],
    trademarkMatches: [],
  };
}

function addDecisionRisk(
  decision: KeywordElonStep4Decision,
  category: KeywordElonStep4RiskCategory,
  reason: string,
  matchedTerm = "",
) {
  decision.blocked = true;
  decision.categories = [...new Set([...decision.categories, category])];
  decision.reasons = [...new Set([...decision.reasons, reason])];
  if (matchedTerm) decision.matchedTerms = [...new Set([...decision.matchedTerms, matchedTerm])];
}

export async function filterKeywordElonProhibitedKeywords(input: {
  identity: KeywordElonIdentity;
  candidates: KeywordElonCandidate[];
  customBlockedTerms: string[];
}): Promise<KeywordElonStep4FilterResult> {
  const candidateMap = new Map<string, KeywordElonCandidate>();
  for (const row of input.candidates) {
    const key = compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword);
    if (!key || candidateMap.has(key)) continue;
    candidateMap.set(key, row);
  }
  const candidates = [...candidateMap.values()].slice(0, 120);
  if (!candidates.length) throw new Error("STEP 4에서 검사할 최종 키워드 재료가 없습니다.");

  const customBlockedTerms = uniqueKeywordElonCanonical(input.customBlockedTerms, 120)
    .filter((term) => term.length >= 2);
  const decisions = candidates.map(createDecision);
  const byKey = new Map(decisions.map((decision) => [decision.searchKey, decision] as const));

  for (const decision of decisions) {
    for (const [category, rawTerms] of Object.entries(BUILTIN_RISK_TERMS) as Array<[
      Exclude<KeywordElonStep4RiskCategory, "trademark" | "custom">,
      string[],
    ]>) {
      for (const rawTerm of rawTerms) {
        const term = compactKeywordElonKey(rawTerm);
        if (!term || !decision.searchKey.includes(term)) continue;
        addDecisionRisk(decision, category, CATEGORY_REASON[category], term);
      }
    }
    for (const term of customBlockedTerms) {
      if (!decision.searchKey.includes(term)) continue;
      addDecisionRisk(decision, "custom", `사용자 금지어 '${term}' 포함`, term);
    }
  }

  const semanticTargets = decisions.filter((decision) => !decision.blocked).map((decision) => decision.keyword);
  const ai = await classifySemanticRisks(input.identity, semanticTargets);
  for (const aiDecision of ai.decisions) {
    if (!aiDecision.blocked) continue;
    const decision = byKey.get(compactKeywordElonKey(aiDecision.keyword));
    if (!decision) continue;
    for (const category of aiDecision.categories) {
      if (category === "trademark" || category === "custom") continue;
      addDecisionRisk(
        decision,
        category,
        `AI 위험영역 판정 ${Math.round(aiDecision.confidence * 100)}% · ${aiDecision.reason}`,
      );
    }
  }

  const kiprisConfigured = keywordElonKiprisConfigured();
  const eligibleForKipris = decisions
    .filter((decision) => !decision.blocked && decision.searchKey.length >= 2 && !/^\d+$/.test(decision.searchKey));
  const kiprisTargets = eligibleForKipris
    .slice(0, KIPRIS_CHECK_LIMIT)
    .map((decision) => decision.keyword);
  const kiprisResults = kiprisConfigured ? await checkKiprisBatch(kiprisTargets) : [];
  for (const result of kiprisResults) {
    if (!result.matches.length) continue;
    const decision = byKey.get(compactKeywordElonKey(result.keyword));
    if (!decision) continue;
    decision.trademarkMatches = result.matches;
    addDecisionRisk(
      decision,
      "trademark",
      `KIPRIS 등록상표 완전일치 ${result.matches.length}건`,
      compactKeywordElonKey(result.keyword),
    );
  }

  const warnings = [
    ai.warning,
    kiprisConfigured ? "" : "KIPRIS_NOT_CONFIGURED",
    ...kiprisResults.map((result) => result.warning),
  ].filter(Boolean);
  if (kiprisConfigured && kiprisTargets.length < eligibleForKipris.length) {
    warnings.push(`KIPRIS_CHECK_LIMIT:${KIPRIS_CHECK_LIMIT}`);
  }

  const allowedKeys = decisions.filter((decision) => !decision.blocked).map((decision) => decision.searchKey);
  const removedKeys = decisions.filter((decision) => decision.blocked).map((decision) => decision.searchKey);
  return {
    inputCount: decisions.length,
    allowedCount: allowedKeys.length,
    removedCount: removedKeys.length,
    allowedKeys,
    removedKeys,
    decisions,
    aiConfigured: ai.configured,
    kiprisConfigured,
    kiprisCheckedCount: kiprisResults.filter((result) => result.checked).length,
    kiprisMatchedCount: decisions.filter((decision) => decision.categories.includes("trademark")).length,
    warnings: [...new Set(warnings)].slice(0, 30),
  };
}
