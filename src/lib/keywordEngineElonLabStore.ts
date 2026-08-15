import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS,
  type KeywordEngineElonLabReviewStatus,
  type KeywordEngineElonLabRunStatus,
} from "@/lib/keywordEngineElonLab";

const TABLE = "keyword_engine_elon_lab_stage_results";

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

export async function listKeywordEngineElonLabRows(): Promise<KeywordEngineElonLabStoredRow[]> {
  const config = supabaseConfig();
  if (!config) return [];
  const keys = KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS.join(",");
  const params = new URLSearchParams({
    select: "*",
    goods_key: `in.(${keys})`,
    order: "stage_index.asc,goods_key.asc",
  });
  const response = await fetch(`${config.baseUrl}/rest/v1/${TABLE}?${params.toString()}`, {
    headers: createSupabaseAdminHeaders(config.secretKey),
    cache: "no-store",
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`KEYWORD_ELON_LAB_SUPABASE_READ_FAILED:${response.status}`);
  }
  return Array.isArray(body) ? (body as KeywordEngineElonLabStoredRow[]) : [];
}

export async function upsertKeywordEngineElonLabRows(rows: KeywordEngineElonLabStoredRow[]) {
  if (!rows.length) return [];
  const config = supabaseConfig();
  if (!config) throw new Error("KEYWORD_ELON_LAB_SUPABASE_NOT_CONFIGURED");
  const params = new URLSearchParams({ on_conflict: "goods_key,stage_key" });
  const headers = createSupabaseAdminHeaders(config.secretKey);
  headers.Prefer = "resolution=merge-duplicates,return=representation";
  const response = await fetch(`${config.baseUrl}/rest/v1/${TABLE}?${params.toString()}`, {
    method: "POST",
    headers,
    body: JSON.stringify(rows.map((row) => ({ ...row, updated_at: new Date().toISOString() }))),
    cache: "no-store",
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`KEYWORD_ELON_LAB_SUPABASE_UPSERT_FAILED:${response.status}`);
  }
  return Array.isArray(body) ? (body as KeywordEngineElonLabStoredRow[]) : [];
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
  const response = await fetch(`${config.baseUrl}/rest/v1/${TABLE}?${params.toString()}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`KEYWORD_ELON_LAB_SUPABASE_REVIEW_FAILED:${response.status}`);
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
