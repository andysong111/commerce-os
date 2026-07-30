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
import {
  findTerminalGithubWorkflowFailure,
} from "@/lib/shoplingPriceAdjustmentWorkflowStatus";
import {
  buildPartialExecutionPlan,
  type PartialExecutionPlan,
} from "@/lib/shoplingPriceAdjustmentPartialPlan";

const ACTIVE_CHUNK_STATUSES = ["pending", "planning", "ready", "executing"] as const;
const LEASE_SECONDS = 90;
const PLAN_WORKFLOW = process.env.SHOPLING_PRICE_ADJUSTMENT_PLAN_WORKFLOW?.trim()
  || "shopling-price-adjustment-plan.yml";
const PLAN_ARTIFACT = "shopling-price-adjustment-plan-summary";
const EXECUTION_WORKFLOW =
  process.env.SHOPLING_PRICE_ADJUSTMENT_BATCH_CANARY_WORKFLOW?.trim()
  || "shopling-price-adjustment-batch-canary.yml";
const EXECUTION_ARTIFACT = "shopling-price-adjustment-batch-canary-summary";

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

const text = (value: unknown) => value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value ?? null);
const firstRecord = (value: unknown) => (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;

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

export function buildExecutionRowsFromPlan(summaryValue: unknown, expectedInputsValue: unknown) {
  const plan = buildPartialExecutionPlan(summaryValue, expectedInputsValue);
  if (plan.rejectedRows.length > 0) {
    throw new Error(`read-only plan contains ${plan.rejectedRows.length} error rows`);
  }
  return plan.executionRows;
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

async function markPlanReady(
  admin: BulkAdmin,
  job: JobRow,
  chunk: ChunkRow,
  plan: PartialExecutionPlan,
  summary: unknown,
  runUrl: string,
) {
  if (plan.rejectedRows.length === 0) {
    await rpc(admin, "mark_shopling_price_adjustment_plan_ready", {
      p_job_id: job.id,
      p_owner_id: job.owner_id,
      p_chunk_id: chunk.id,
      p_execution_rows: plan.executionRows,
      p_summary: summary,
      p_run_url: runUrl,
    });
    return;
  }

  const now = new Date().toISOString();
  for (const rejected of plan.rejectedRows) {
    const itemResult = await admin
      .from("shopling_price_adjustment_bulk_items")
      .update({
        status: "not_executed",
        result: {
          status: "not_executed",
          stage: "planning",
          error: rejected.error,
        },
        updated_at: now,
      })
      .eq("job_id", job.id)
      .eq("goods_key", rejected.goods_key)
      .in("status", ["pending", "not_executed"]);
    if (itemResult.error) {
      throw new Error(`rejected item state update failed: ${text(itemResult.error)}`);
    }
  }

  const chunkResult = await admin
    .from("shopling_price_adjustment_bulk_chunks")
    .update({
      status: "ready",
      input_rows: plan.validInputs,
      execution_rows: plan.executionRows,
      goods_key_count: plan.executionRows.length,
      plan_summary: summary,
      plan_run_url: runUrl,
      last_error: `${plan.rejectedRows.length}개 조회 오류 상품 자동 제외`,
      updated_at: now,
    })
    .eq("id", chunk.id)
    .eq("job_id", job.id)
    .eq("status", "planning")
    .select("id")
    .maybeSingle();
  if (chunkResult.error || !chunkResult.data) {
    throw new Error(`partial plan ready transition failed: ${text(chunkResult.error)}`);
  }
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
  if (result.status === "pending" || result.status === "error" || !result.summary) {
    const terminalFailure = await findTerminalGithubWorkflowFailure({
      requestId,
      workflow: PLAN_WORKFLOW,
      artifactName: PLAN_ARTIFACT,
      operationLabel: "현재가·옵션 조회",
    });
    if (terminalFailure) {
      return failJob(
        admin,
        job,
        chunk,
        `${terminalFailure.message}${
          terminalFailure.runUrl ? ` · 실행 로그: ${terminalFailure.runUrl}` : ""
        }`,
      );
    }
    return {
      status: "waiting" as const,
      jobStatus: "running",
      chunkIndex: chunk.chunk_index,
      message: result.message ?? "계획 결과를 아직 확인하지 못했습니다.",
    };
  }

  let plan: PartialExecutionPlan;
  try {
    plan = buildPartialExecutionPlan(result.summary, chunk.input_rows);
  } catch (error) {
    return failJob(admin, job, chunk, `읽기 전용 계획 검증 실패: ${text(error)}`);
  }
  try {
    await markPlanReady(
      admin,
      job,
      chunk,
      plan,
      result.summary,
      result.runUrl ?? "",
    );
  } catch (error) {
    return failJob(admin, job, chunk, `읽기 전용 계획 저장 실패: ${text(error)}`);
  }
  const excluded = plan.rejectedRows.length;
  return {
    status: "progressed" as const,
    jobStatus: "running",
    chunkIndex: chunk.chunk_index,
    message: excluded > 0
      ? `${plan.executionRows.length}개 상품의 실행 계획을 확정하고 조회 오류 ${excluded}개를 자동 제외했습니다.`
      : `${plan.executionRows.length}개 상품의 실행 계획을 확정했습니다.`,
  };
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
  if (result.status === "pending" || result.status === "error" || !result.summary) {
    const terminalFailure = await findTerminalGithubWorkflowFailure({
      requestId,
      workflow: EXECUTION_WORKFLOW,
      artifactName: EXECUTION_ARTIFACT,
      operationLabel: "실제 가격 변경",
    });
    if (terminalFailure) {
      return blockUncertain(
        admin,
        job,
        chunk,
        `${terminalFailure.message} 실제 변경 단계였으므로 중복 실행하지 말고 실행 로그와 샵플링 반영 여부를 먼저 확인하세요.${
          terminalFailure.runUrl ? ` · 실행 로그: ${terminalFailure.runUrl}` : ""
        }`,
      );
    }
    return {
      status: "waiting" as const,
      jobStatus: "running",
      chunkIndex: chunk.chunk_index,
      message: result.message ?? "실행 결과를 아직 확인하지 못했습니다.",
    };
  }
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
