import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createBulkChunks } from "@/lib/shoplingPriceModifyBulkJobs";
import { validateShoplingPriceModifyPolicyOverrides } from "@/lib/shoplingPriceModifyRunner";

type Query = PromiseLike<{ data: unknown; error: { message: string } | null }> & { select: (...args: unknown[]) => Query; insert: (...args: unknown[]) => Query; update: (...args: unknown[]) => Query; eq: (...args: unknown[]) => Query; order: (...args: unknown[]) => Query; limit: (...args: unknown[]) => Query; single: () => Query };
type Admin = { from: (table: string) => Query; rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
async function admin() { const client = await createSupabaseAdminClient(); if (!client) throw new Error("Supabase 서버 설정이 필요합니다."); return client as Admin; }
function failure(error: { message: string } | null) { if (error) throw new Error(error.message.slice(0, 500)); }

export type CreateBulkJobInput = { goodsKeys: string[]; inputSource: "paste" | "csv" | "xlsx"; totalInputCount: number; duplicateCount: number; invalidCount: number; policyOverrides?: unknown; retryOfJobId?: string };
export async function createBulkJob(input: CreateBulkJobInput) {
  if (!input.goodsKeys.length || input.goodsKeys.length > 20_000 || input.goodsKeys.some((key) => !/^\d+$/.test(key))) throw new Error("goods_key 입력이 올바르지 않습니다.");
  const unique = [...new Set(input.goodsKeys)]; if (unique.length !== input.goodsKeys.length) throw new Error("중복 goods_key는 서버 요청 전에 제거해야 합니다.");
  const policies = validateShoplingPriceModifyPolicyOverrides(input.policyOverrides); const chunks = createBulkChunks(unique); const db = await admin();
  const jobResult = await db.from("shopling_price_bulk_jobs").insert({ status: "queued", input_source: input.inputSource, total_input_count: input.totalInputCount, valid_goods_key_count: unique.length, duplicate_count: input.duplicateCount, invalid_count: input.invalidCount, chunk_size: 50, max_parallel: 1, total_chunk_count: chunks.length, policy_overrides: policies, retry_of_job_id: input.retryOfJobId ?? null }).select().single(); failure(jobResult.error);
  const job = jobResult.data as { id: string }; const chunkResult = await db.from("shopling_price_bulk_chunks").insert(chunks.map((chunk) => ({ ...chunk, job_id: job.id, policy_overrides: policies }))); failure(chunkResult.error); return getBulkJob(job.id);
}
export async function listBulkJobs() { const result = await (await admin()).from("shopling_price_bulk_jobs").select("*").order("created_at", { ascending: false }).limit(10); failure(result.error); return result.data; }
export async function getBulkJob(id: string) { const db = await admin(); const [job, chunks] = await Promise.all([db.from("shopling_price_bulk_jobs").select("*").eq("id", id).single(), db.from("shopling_price_bulk_chunks").select("*").eq("job_id", id).order("chunk_index", { ascending: true })]); failure(job.error); failure(chunks.error); return { job: job.data, chunks: chunks.data }; }
export async function setBulkJobPaused(id: string, paused: boolean) { const result = await (await admin()).from("shopling_price_bulk_jobs").update({ status: paused ? "paused" : "running", updated_at: new Date().toISOString() }).eq("id", id).select().single(); failure(result.error); return result.data; }
export async function retryFailedBulkJob(id: string) { const current = await getBulkJob(id) as { job: Record<string, unknown>; chunks: Array<Record<string, unknown>> }; const failed = [...new Set(current.chunks.flatMap((chunk) => Array.isArray(chunk.failed_goods_keys) ? chunk.failed_goods_keys : []).filter((key): key is string => typeof key === "string"))]; if (!failed.length) throw new Error("다시 실행할 최종 실패 goods_key가 없습니다."); return createBulkJob({ goodsKeys: failed, inputSource: "paste", totalInputCount: failed.length, duplicateCount: 0, invalidCount: 0, policyOverrides: current.job.policy_overrides, retryOfJobId: id }); }
export async function bulkRpc(name: string, args?: Record<string, unknown>) { const result = await (await admin()).rpc(name, args); failure(result.error); return result.data; }
export async function bulkUpdate(table: string, values: Record<string, unknown>, id: string) { const result = await (await admin()).from(table).update(values).eq("id", id).select().single(); failure(result.error); return result.data; }
