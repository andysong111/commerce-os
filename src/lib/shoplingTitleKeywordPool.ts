type JsonRecord = Record<string, unknown>;

const MAX_POOL_SIZE = 64;
const MAX_KEYWORD_CHARS = 60;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function normalizeShoplingTitleKeyword(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > MAX_KEYWORD_CHARS) return "";
  if (!/[0-9A-Za-z가-힣]/.test(normalized)) return "";
  return normalized;
}

function candidateKeyword(value: unknown): string {
  if (typeof value === "string") return normalizeShoplingTitleKeyword(value);
  const row = asRecord(value);
  if (!row) return "";
  return normalizeShoplingTitleKeyword(row.keyword ?? row.term ?? row.value);
}

function candidateAllowed(value: unknown): boolean {
  if (typeof value === "string") return true;
  const row = asRecord(value);
  if (!row) return false;
  if (row.safetyPass === false) return false;
  if (row.titleEligible === false) return false;
  if (row.categoryAligned === false) return false;
  if (row.blocked === true || row.prohibited === true) return false;
  return true;
}

function appendCandidates(target: string[], seen: Set<string>, values: unknown) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    if (!candidateAllowed(value)) continue;
    const keyword = candidateKeyword(value);
    if (!keyword) continue;
    const key = keyword.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(keyword);
    if (target.length >= MAX_POOL_SIZE) return;
  }
}

export function buildShoplingTitleKeywordPool(checkpointPayload: unknown): string[] {
  const checkpoint = asRecord(checkpointPayload);
  if (!checkpoint) return [];

  const result: string[] = [];
  const seen = new Set<string>();
  const titleResult = asRecord(checkpoint.titleResult);

  appendCandidates(result, seen, titleResult?.usedKeywords);
  if (result.length < MAX_POOL_SIZE) {
    appendCandidates(result, seen, checkpoint.finalCandidates);
  }
  if (result.length < MAX_POOL_SIZE) {
    appendCandidates(result, seen, checkpoint.allowedCandidates);
  }

  return result.slice(0, MAX_POOL_SIZE);
}
