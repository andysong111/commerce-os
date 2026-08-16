import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS,
  type KeywordEngineElonLabReviewStatus,
  type KeywordEngineElonLabRunStatus,
} from "@/lib/keywordEngineElonLab";

const TABLE = "keyword_engine_elon_lab_stage_results";
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

export type KeywordEngineElonLabStoredRow = {
  goods_key: string;
  stage_key: string;
  stage_index: number;
  run_status: KeywordEngineElonLabRunStatus;
  review_status: KeywordEngineElonLabReviewStatus;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown>;
  error_message: string;
  review_note: string;
  engine_revision: string;
  created_at?: string;
  updated_at?: string;
};

function supabaseConfig() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!baseUrl || !secretKey) return null;
  return { baseUrl, secretKey };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function bodySummary(body: unknown) {
  if (body === null || body === undefined) return "";
  const value = typeof body === "string" ? body : JSON.stringify(body);
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function withBody(code: string, status: number, body: unknown) {
  const summary = bodySummary(body);
  return `${code}:${status}${summary ? `:${summary}` : ""}`;
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3) {
  let lastResponse: Response | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, init);
    lastResponse = response;
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === attempts) return response;
    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }
  return lastResponse!;
}

function rowWritePayload(row: KeywordEngineElonLabStoredRow) {
  return {
    goods_key: row.goods_key,
    stage_key: row.stage_key,
    stage_index: row.stage_index,
    run_status: row.run_status,
    review_status: row.review_status,
    input_payload: row.input_payload,
    output_payload: row.output_payload,
    error_message: row.error_message,
    review_note: row.review_note,
    engine_revision: row.engine_revision,
    updated_at: new Date().toISOString(),
  };
}

export async function listKeywordEngineElonLabRows(): Promise<KeywordEngineElonLabStoredRow[]> {
  const config = supabaseConfig();
  if (!config) return [];
  const keys = KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.join(",");
  const params = new URLSearchParams({
    select: "*",
    goods_key: `in.(${keys})`,
    order: "stage_index.asc,goods_key.asc",
  });
  const response = await fetchWithRetry(`${config.baseUrl}/rest/v1/${TABLE}?${params.toString()}`, {
    headers: createSupabaseAdminHeaders(config.secretKey),
    cache: "no-store",
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(withBody("KEYWORD_ELON_LAB_SUPABASE_READ_FAILED", response.status, body));
  }
  return Array.isArray(body) ? (body as KeywordEngineElonLabStoredRow[]) : [];
}

async function patchOrInsertKeywordEngineElonLabRow(
  config: { baseUrl: string; secretKey: string },
  row: KeywordEngineElonLabStoredRow,
) {
  const payload = rowWritePayload(row);
  const patchParams = new URLSearchParams({
    goods_key: `eq.${row.goods_key}`,
    stage_key: `eq.${row.stage_key}`,
  });
  const patchHeaders = createSupabaseAdminHeaders(config.secretKey);
  patchHeaders.Prefer = "return=representation";
  const patchResponse = await fetchWithRetry(
    `${config.baseUrl}/rest/v1/${TABLE}?${patchParams.toString()}`,
    {
      method: "PATCH",
      headers: patchHeaders,
      body: JSON.stringify(payload),
      cache: "no-store",
    },
  );
  const patchBody = await readJson(patchResponse);
  if (!patchResponse.ok) {
    throw new Error(withBody("KEYWORD_ELON_LAB_SUPABASE_PATCH_FAILED", patchResponse.status, patchBody));
  }
  if (Array.isArray(patchBody) && patchBody.length > 0) {
    return patchBody as KeywordEngineElonLabStoredRow[];
  }

  const insertHeaders = createSupabaseAdminHeaders(config.secretKey);
  insertHeaders.Prefer = "return=representation";
  const insertResponse = await fetchWithRetry(`${config.baseUrl}/rest/v1/${TABLE}`, {
    method: "POST",
    headers: insertHeaders,
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const insertBody = await readJson(insertResponse);
  if (!insertResponse.ok) {
    throw new Error(withBody("KEYWORD_ELON_LAB_SUPABASE_INSERT_FAILED", insertResponse.status, insertBody));
  }
  return Array.isArray(insertBody) ? (insertBody as KeywordEngineElonLabStoredRow[]) : [];
}

export async function upsertKeywordEngineElonLabRows(rows: KeywordEngineElonLabStoredRow[]) {
  if (!rows.length) return [];
  const config = supabaseConfig();
  if (!config) throw new Error("KEYWORD_ELON_LAB_SUPABASE_NOT_CONFIGURED");

  const stored: KeywordEngineElonLabStoredRow[] = [];
  for (const row of rows) {
    stored.push(...(await patchOrInsertKeywordEngineElonLabRow(config, row)));
  }
  return stored;
}

async function patchKeywordEngineElonLabReview(input: {
  goodsKeys: string[];
  stageKey: string;
  reviewStatus: KeywordEngineElonLabReviewStatus;
  reviewNote?: string;
}) {
  if (!input.goodsKeys.length) return [];
  const config = supabaseConfig();
  if (!config) throw new Error("KEYWORD_ELON_LAB_SUPABASE_NOT_CONFIGURED");
  const params = new URLSearchParams({
    goods_key: `in.(${input.goodsKeys.join(",")})`,
    stage_key: `eq.${input.stageKey}`,
  });
  const headers = createSupabaseAdminHeaders(config.secretKey);
  headers.Prefer = "return=representation";
  const payload: Record<string, unknown> = {
    review_status: input.reviewStatus,
  };
  if (input.reviewNote !== undefined) payload.review_note = input.reviewNote;

  // updated_at intentionally represents the stage execution result timestamp.
  // Review-only changes must not mutate it, otherwise downstream results look stale
  // after a refresh or a later code deployment.
  const response = await fetchWithRetry(`${config.baseUrl}/rest/v1/${TABLE}?${params.toString()}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(withBody("KEYWORD_ELON_LAB_SUPABASE_REVIEW_FAILED", response.status, body));
  }
  return Array.isArray(body) ? (body as KeywordEngineElonLabStoredRow[]) : [];
}

export async function updateKeywordEngineElonLabReview(input: {
  goodsKey: string;
  stageKey: string;
  reviewStatus: KeywordEngineElonLabReviewStatus;
  reviewNote: string;
}) {
  return patchKeywordEngineElonLabReview({
    goodsKeys: [input.goodsKey],
    stageKey: input.stageKey,
    reviewStatus: input.reviewStatus,
    reviewNote: input.reviewNote,
  });
}

export async function updateKeywordEngineElonLabReviews(input: {
  goodsKeys: string[];
  stageKey: string;
  reviewStatus: KeywordEngineElonLabReviewStatus;
}) {
  return patchKeywordEngineElonLabReview({
    goodsKeys: input.goodsKeys,
    stageKey: input.stageKey,
    reviewStatus: input.reviewStatus,
  });
}
