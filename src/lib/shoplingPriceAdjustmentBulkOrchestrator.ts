import { randomUUID } from "node:crypto";
import type { BulkAdmin } from "@/lib/shoplingPriceModifyBulkApi";
import {
  dispatchShoplingPriceAdjustmentPlan,
  fetchShoplingPriceAdjustmentPlanResult,
} from "@/lib/shoplingPriceAdjustmentPlanRunner";
import {
  dispatchShoplingPriceAdjustmentBatchCanary,
  fetchShoplingPriceAdjustmentBatchCanaryResult,
} from "@/lib/shoplingPriceAdjustmentBatchCanaryRunner";

const ACTIVE_CHUNK_STATUSES = ["pending", "planning", "ready", "executing"] as const;
const LEASE_SECONDS = 90;

export type ShoplingPriceAdjustmentBulkAdvanceResult = {
  status: "waiting" | "progressed" | "dispatched" | "finished" | "stopped" | "busy";
  jobStatus?: string;
  chunkIndex?: number;
  message: string;
};

type JobRow = {
  id: string;
  owner_id: string;
  status: string;
  pause_requested?: boolean;
  valid_count?: number;
  total_chunk_count?: number;
};

type ChunkRow = {
  id: string;
  job_id: string;
  chunk_index: number;
  chunk_type: "canary" | "normal";
  status: "pending" | "planning" | "ready" | "executing";
  input_rows?: unknown;
  execution_rows?: unknown;
  goods_key_count: number;
  plan_request_id?: string | null;
  execute_request_id?: string | null;
};

type PlanRow = {
  goods_key?: unknown;
  adjustment_bps?: unknown;
  current?: {
    sell_price?: unknown;
    option_amounts?: unknown;
    option_signature?: unknown;
  };
  target?: {
    sell_price?: unknown;
    option_amounts?: unknown;
  };
};

const text = (value: unknown) => value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value ?? null);
const firstRecord = (value: unknown) => (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
const records = (value: unknown) => Array.isArray(value) ? value as Array<Record<string, unknown>> : [];

async function rpc(admin: BulkAdmin, name: string, parameters: Record<string, unknown>) {
  const result = await admin.rpc(name, parameters);
  if (result.error) throw new Error(`${name}: ${text(result.error)}`);
  return result.data;
}

async function loadJob(admin: BulkAdmin, jobId: string, ownerId: string): Promise<JobRow> {
  const result = await admin.from("shopling_price_adjustment_bulk_jobs")
    .select("id,owner_id,status,pause_requested,valid_count,total_chunk_count")
    .eq("id", jobId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (result.error) throw new Error(`adjustment bulk job query failed: ${text(result.error)}`);
  if (!result.data) throw new Error("adjustment bulk job not found");
  return result.data as unknown as JobRow;
}

async function loadNextChunk(admin: BulkAdmin, jobId: string): Promise<ChunkRow | null> {
  const result = await admin.from("shopling_price_adjustment_bulk_chunks")
    .select("id,job_id,chunk_index,chunk_type,status,input_rows,execution_rows,goods_key_count,plan_request_id,execute_request_id")
    .eq("job_id", jobId)
    .in("status", ACTIVE_CHUNK_STATUSES)
    .order("chunk_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(`adjustment bulk chunk query failed: ${text(result.error)}`);
  return result.data as unknown as ChunkRow | null;
}

function parsePlanInputs(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) throw new Error("chunk input rows must contain 1..50 rows");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`chunk row ${index + 1} is invalid`);
    const row = entry as Record<string, unknown>;
    const goodsKey = row.goods_key;
    const adjustmentBps = row.adjustment_bps;
    if (typeof goodsKey !== "string" || !/^\d+$/.test(goodsKey)) throw new Error(`chunk row ${index + 1} goods_key is invalid`);
    if (seen.has(goodsKey)) throw new Error(`duplicate goods_key in chunk: ${goodsKey}`);
    if (typeof adjustmentBps !== "number" || !Number.isInteger(adjustmentBps) || adjustmentBps < -9_999 || adjustmentBps > 100_000) {
      throw new Error(`chunk row ${index + 1} adjustment_bps is invalid`);
    }
    seen.add(goodsKey);
    return { goods_key: goodsKey, adjustment_bps: adjustmentBps };
  });
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  if (!value.every((item) => typeof item === "number" && Number.isSafeInteger(item))) throw new Error("option amount array is invalid");
  return value as number[];
}

function sameNumberArray(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function buildExecutionRowsFromPlan(summaryValue: unknown, expectedInputsValue: unknown) {
  const summary = (summaryValue ?? {}) as Record<string, unknown>;
  if (summary.status !== "success") throw new Error(`read-only plan did not succeed: ${String(summary.status ?? "unknown")}`);
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  if (errors.length > 0) throw new Error(`read-only plan contains ${errors.length} error rows`);

  const expectedInputs = parsePlanInputs(expectedInputsValue);
  const rows = Array.isArray(summary.rows) ? summary.rows as PlanRow[] : [];
  if (rows.length !== expectedInputs.length) throw new Error(`planned row count mismatch expected=${expectedInputs.length} actual=${rows.length}`);
  const byKey = new Map(rows.map((row) => [row.goods_key, row]));

  return expectedInputs.map((expected, index) => {
    const row = byKey.get(expected.goods_key);
    if (!row) throw new Error(`plan result missing goods_key ${expected.goods_key}`);
    if (row.adjustment_bps !== expected.adjustment_bps) throw new Error(`plan rate mismatch for ${expected.goods_key}`);
    const currentSell = row.current?.sell_price;
    const optionSignature = row.current?.option_signature;
    const targetSell = row.target?.sell_price;
    if (typeof currentSell !== "number" || !Number.isSafeInteger(currentSell) || currentSell <= 0) throw new Error(`plan current price missing for row ${index + 1}`);
    if (typeof targetSell !== "number" || !Number.isSafeInteger(targetSell) || targetSell <= 0) throw new Error(`plan target price missing for row ${index + 1}`);
    if (typeof optionSignature !== "string" || !/^[0-9a-f]{64}$/i.test(optionSignature)) throw new Error(`plan option signature missing for ${expected.goods_key}`);
    const currentOptions = numberArray(row.current?.option_amounts);
    const targetOptions = numberArray(row.target?.option_amounts);
    return {
      goods_key: expected.goods_key,
      adjustment_bps: expected.adjustment_bps,
      expected_current_sell_price: currentSell,
      expected_option_signature: optionSignature.toLowerCase(),
      requires_option_write: !sameNumberArray(currentOptions, targetOptions),
    };
  });
}

function executionSucceeded(summaryValue: unknown, expectedCount: number) {
  const summary = (summaryValue ?? {}) as Record<string, unknown>;
  return summary.status === "success"
    && summary.success_count === expectedCount
    && summary.failed_count === 0
    && summary.not_executed_count === 0;
}

async function failJob(admin: BulkAdmin, job: JobRow, chunk: ChunkRow, reason: string): Promise<ShoplingPriceAdjustmentBulkAdvanceResult> {
  await rpc(admin, "fail_shopling_price_adjustment_bulk_job", {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_chunk_id: chunk.id,
    p_error: reason,
  });
  return { status: "stopped", jobStatus: "failed", chunkIndex: chunk.chunk_index, message: reason };
}

async function blockUncertain(admin: BulkAdmin, job: JobRow, chunk: ChunkRow, reason: string): Promise<ShoplingPriceAdjustmentBulkAdvanceResult> {
  await rpc(admin, "block_shopling_price_adjustment_dispatch_uncertain", {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_chunk_id: chunk.id,
    p_error: reason,
  });
  return { status: "stopped", jobStatus: "dispatch_uncertain", chunkIndex: chunk.chunk_index, message: reason };
}

async function advancePending(admin: BulkAdmin, job: JobRow, chunk: ChunkRow) {
  let inputs;
  try { inputs = parsePlanInputs(chunk.input_rows); }
  catch (error) { return failJob(admin, job, chunk, `청크 입력 검증 실패: ${text(error)}`); }
  const dispatched = await dispatchShoplingPriceAdjustmentPlan(inputs);
  if (dispatched.status !== "success" || !dispatched.requestId) {
    return failJob(admin, job, chunk, `읽기 전용 계획 요청 실패: ${dispatched.message ?? "unknown"}`);
  }
  try {
    await rpc(admin, "mark_shopling_price_adjustment_plan_dispatched", {
      p_job_id: job.id,
      p_owner_id: job.owner_id,
      p_chunk_id: chunk.id,
      p_request_id: dispatched.requestId,
      p_actions_url: dispatched.githubActionsUrl ?? "",
    });
  } catch (error) {
    return blockUncertain(admin, job, chunk, `계획 요청은 수락됐지만 상태 저장이 불확실합니다: ${text(error)}`);
  }
  return {
    status: "dispatched" as const,
    jobStatus: "running",
    chunkIndex: chunk.chunk_index,
    message: `${inputs.length}개 상품의 읽기 전용 계획을 시작했습니다.`,
  };
}

async function advancePlanning(admin: BulkAdmin, job: JobRow, chunk: ChunkRow) {
  const requestId = chunk.plan_request_id ?? "";
  if (!requestId) return failJob(admin, job, chunk, "계획 request_id가 없습니다.");
  const result = await fetchShoplingPriceAdjustmentPlanResult(requestId);
  if (result.status === "pending") return { status: "waiting" as const, jobStatus: "running", chunkIndex: chunk.chunk_index, message: result.message ?? "계획 결과 대기 중" };
  if (result.status === "error" || !result.summary) return { status: "waiting" as const, jobStatus: "running", chunkIndex: chunk.chunk_index, message: result.message ?? "계획 결과를 아직 확인하지 못했습니다." };
  let executionRows;
  try { executionRows = buildExecutionRowsFromPlan(result.summary, chunk.input_rows); }
  catch (error) { return failJob(admin, job, chunk, `읽기 전용 계획 검증 실패: ${text(error)}`); }
  await rpc(admin, "mark_shopling_price_adjustment_plan_ready", {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_chunk_id: chunk.id,
    p_execution_rows: executionRows,
    p_summary: result.summary,
    p_run_url: result.runUrl ?? "",
  });
  return { status: "progressed" as const, jobStatus: "running", chunkIndex: chunk.chunk_index, message: `${executionRows.length}개 상품의 실행 계획을 확정했습니다.` };
}

async function advanceReady(admin: BulkAdmin, job: JobRow, chunk: ChunkRow) {
  if (!Array.isArray(chunk.execution_rows) || chunk.execution_rows.length === 0) return failJob(admin, job, chunk, "실행 스냅샷이 없습니다.");
  const dispatched = await dispatchShoplingPriceAdjustmentBatchCanary(chunk.execution_rows);
  if (dispatched.status !== "success" || !dispatched.requestId) {
    return failJob(admin, job, chunk, `실제 가격 변경 요청 실패: ${dispatched.message ?? "unknown"}`);
  }
  try {
    await rpc(admin, "mark_shopling_price_adjustment_execution_dispatched", {
      p_job_id: job.id,
      p_owner_id: job.owner_id,
      p_chunk_id: chunk.id,
      p_request_id: dispatched.requestId,
      p_actions_url: dispatched.githubActionsUrl ?? "",
    });
  } catch (error) {
    return blockUncertain(admin, job, chunk, `가격 변경 요청은 수락됐지만 상태 저장이 불확실합니다: ${text(error)}`);
  }
  return { status: "dispatched" as const, jobStatus: "running", chunkIndex: chunk.chunk_index, message: `${chunk.execution_rows.length}개 상품의 실제 가격 변경을 시작했습니다.` };
}

async function advanceExecuting(admin: BulkAdmin, job: JobRow, chunk: ChunkRow) {
  const requestId = chunk.execute_request_id ?? "";
  if (!requestId) return failJob(admin, job, chunk, "실행 request_id가 없습니다.");
  const result = await fetchShoplingPriceAdjustmentBatchCanaryResult(requestId);
  if (result.status === "pending") return { status: "waiting" as const, jobStatus: "running", chunkIndex: chunk.chunk_index, message: result.message ?? "실행 결과 대기 중" };
  if (result.status === "error" || !result.summary) return { status: "waiting" as const, jobStatus: "running", chunkIndex: chunk.chunk_index, message: result.message ?? "실행 결과를 아직 확인하지 못했습니다." };
  const success = executionSucceeded(result.summary, chunk.goods_key_count);
  const finish = await rpc(admin, "finish_shopling_price_adjustment_execution", {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_chunk_id: chunk.id,
    p_summary: result.summary,
    p_run_url: result.runUrl ?? "",
    p_success: success,
    p_error: success ? null : `청크 ${chunk.chunk_index} 실행 실패`,
  });
  const status = String(firstRecord(finish)?.status ?? (success ? "running" : "failed"));
  if (!success) return { status: "stopped" as const, jobStatus: status, chunkIndex: chunk.chunk_index, message: `청크 ${chunk.chunk_index}에서 실패하여 이후 실행을 중단했습니다.` };
  if (status === "succeeded") return { status: "finished" as const, jobStatus: status, chunkIndex: chunk.chunk_index, message: "최대 10,000개 가격 변경 작업을 모두 완료했습니다." };
  return { status: "progressed" as const, jobStatus: status, chunkIndex: chunk.chunk_index, message: `청크 ${chunk.chunk_index}의 ${chunk.goods_key_count}개 상품을 완료했습니다.` };
}

export async function advanceShoplingPriceAdjustmentBulkJob(
  admin: BulkAdmin,
  jobId: string,
  ownerId: string,
  workerId = `adjustment-bulk-${randomUUID()}`,
): Promise<ShoplingPriceAdjustmentBulkAdvanceResult> {
  const claimed = firstRecord(await rpc(admin, "claim_shopling_price_adjustment_bulk_job", {
    p_job_id: jobId,
    p_owner_id: ownerId,
    p_worker_id: workerId,
    p_lease_seconds: LEASE_SECONDS,
  }));
  if (!claimed?.claimed) {
    const status = String(claimed?.status ?? "unknown");
    if (status === "succeeded") return { status: "finished", jobStatus: status, message: "작업이 이미 완료되었습니다." };
    if (["failed", "dispatch_uncertain", "cancelled"].includes(status)) return { status: "stopped", jobStatus: status, message: `작업 상태: ${status}` };
    if (status === "paused") return { status: "stopped", jobStatus: status, message: "작업이 일시중지되었습니다." };
    return { status: "busy", jobStatus: status, message: "다른 실행 요청이 현재 작업을 처리하고 있습니다." };
  }

  try {
    const job = await loadJob(admin, jobId, ownerId);
    const chunk = await loadNextChunk(admin, jobId);
    if (!chunk) {
      return { status: job.status === "succeeded" ? "finished" : "waiting", jobStatus: job.status, message: "다음 청크 상태를 확인하고 있습니다." };
    }
    if (chunk.status === "pending") return await advancePending(admin, job, chunk);
    if (chunk.status === "planning") return await advancePlanning(admin, job, chunk);
    if (chunk.status === "ready") return await advanceReady(admin, job, chunk);
    return await advanceExecuting(admin, job, chunk);
  } finally {
    try {
      await rpc(admin, "release_shopling_price_adjustment_bulk_job", {
        p_job_id: jobId,
        p_owner_id: ownerId,
        p_worker_id: workerId,
      });
    } catch {
      // Lease expiration is the recovery boundary. Do not mask the real step result.
    }
  }
}
