import { randomUUID } from "node:crypto";
import type { BulkAdmin } from "@/lib/shoplingPriceModifyBulkApi";
import {
  analyzeShoplingPriceBulkCanaryResult,
  dispatchShoplingPriceBulkCanary,
} from "@/lib/shoplingPriceModifyBulkCanary";
import {
  analyzeShoplingPriceBulkNormalResult,
  dispatchShoplingPriceBulkNormal,
} from "@/lib/shoplingPriceModifyBulkNormal";
import {
  analyzeShoplingPriceBulkRetryResult,
  dispatchShoplingPriceBulkRetry,
} from "@/lib/shoplingPriceModifyBulkRetry";
import { decideNormalDispatchingReconciliation } from "@/lib/shoplingPriceModifyBulkReconciliation";
import {
  fetchShoplingPriceModifyActionsResult,
  generateShoplingPriceModifyRequestId,
} from "@/lib/shoplingPriceModifyRunner";

const ACTIVE_CHUNK_STATUSES = ["dispatching", "running", "dispatch_uncertain"] as const;
const LEASE_SECONDS = 75;

export type ShoplingPriceBulkAutoClaim = {
  claimed: boolean;
  job_id?: string;
  owner_id?: string;
  status?: string;
  worker_id?: string;
};

export type ShoplingPriceBulkAutoRunResult = {
  jobId: string;
  transitions: number;
  outcome: "waiting" | "dispatched" | "finished" | "stopped" | "noop";
  status?: string;
  message: string;
  leaseReleased: boolean;
};

type StepResult = {
  outcome: "progressed" | "waiting" | "dispatched" | "finished" | "stopped" | "noop";
  status?: string;
  message: string;
  leaseReleased?: boolean;
};

type JobRow = {
  id: string;
  owner_id: string;
  status: string;
  execution_mode: string;
  automation_mode: string;
  automation_worker_id?: string | null;
  automation_stop_reason?: string | null;
  archived_at?: string | null;
  pause_requested?: boolean;
};

type ChunkRow = {
  chunk_index: number;
  chunk_type: "canary" | "normal" | "retry";
  status: string;
  goods_keys?: unknown;
  request_id?: string | null;
  started_at?: string | null;
};

const rows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
const record = (value: unknown): Record<string, unknown> => (Array.isArray(value) ? value[0] : value) as Record<string, unknown>;
const text = (value: unknown) => value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value ?? null);
const goodsKeys = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

async function rpc(admin: BulkAdmin, name: string, parameters: Record<string, unknown>) {
  const result = await admin.rpc(name, parameters);
  if (result.error) throw new Error(`${name}: ${text(result.error)}`);
  return result.data;
}

async function loadJob(admin: BulkAdmin, jobId: string, ownerId: string): Promise<JobRow> {
  const result = await admin.from("shopling_price_bulk_jobs")
    .select("id,owner_id,status,execution_mode,automation_mode,automation_worker_id,automation_stop_reason,archived_at,pause_requested")
    .eq("id", jobId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (result.error) throw new Error(`auto job query failed: ${text(result.error)}`);
  if (!result.data) throw new Error("auto job not found");
  return result.data as unknown as JobRow;
}

async function loadActiveChunks(admin: BulkAdmin, jobId: string, chunkType?: ChunkRow["chunk_type"]): Promise<ChunkRow[]> {
  let query = admin.from("shopling_price_bulk_chunks")
    .select("chunk_index,chunk_type,status,goods_keys,request_id,started_at")
    .eq("job_id", jobId)
    .in("status", ACTIVE_CHUNK_STATUSES)
    .order("chunk_index", { ascending: true })
    .limit(2);
  if (chunkType) query = query.eq("chunk_type", chunkType);
  const result = await query;
  if (result.error) throw new Error(`active chunk query failed: ${text(result.error)}`);
  return rows(result.data) as unknown as ChunkRow[];
}

async function countChunks(admin: BulkAdmin, jobId: string, chunkType: string) {
  const result = await admin.from("shopling_price_bulk_chunks")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("chunk_type", chunkType);
  if (result.error) throw new Error(`chunk count failed: ${text(result.error)}`);
  return result.count ?? 0;
}

export function createShoplingPriceBulkAutoWorkerId(prefix = "auto") {
  return `${prefix}-${randomUUID()}`;
}

export async function claimNextShoplingPriceBulkAutoJob(
  admin: BulkAdmin,
  workerId: string,
  leaseSeconds = LEASE_SECONDS,
): Promise<ShoplingPriceBulkAutoClaim> {
  const data = await rpc(admin, "claim_next_shopling_price_bulk_auto_job", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  return record(data) as unknown as ShoplingPriceBulkAutoClaim;
}

export async function releaseShoplingPriceBulkAutoJob(admin: BulkAdmin, jobId: string, workerId: string) {
  await rpc(admin, "release_shopling_price_bulk_auto_job", { p_job_id: jobId, p_worker_id: workerId });
}

async function finishAuto(admin: BulkAdmin, jobId: string, ownerId: string, workerId: string, status: string): Promise<StepResult> {
  await rpc(admin, "finish_shopling_price_bulk_auto_job", {
    p_job_id: jobId,
    p_owner_id: ownerId,
    p_worker_id: workerId,
  });
  return { outcome: "finished", status, message: "모든 상품의 가격 변경이 완료되었습니다.", leaseReleased: true };
}

async function stopAuto(admin: BulkAdmin, jobId: string, ownerId: string, workerId: string, reason: string, status?: string): Promise<StepResult> {
  await rpc(admin, "stop_shopling_price_bulk_auto_job", {
    p_job_id: jobId,
    p_owner_id: ownerId,
    p_worker_id: workerId,
    p_reason: reason,
  });
  return { outcome: "stopped", status, message: reason, leaseReleased: true };
}

async function blockUncertain(admin: BulkAdmin, type: ChunkRow["chunk_type"], jobId: string, ownerId: string, requestId: string, reason: string) {
  const name = type === "canary"
    ? "block_shopling_price_bulk_canary_uncertain"
    : type === "retry"
      ? "block_shopling_price_bulk_retry_uncertain"
      : "block_shopling_price_bulk_normal_uncertain";
  await rpc(admin, name, {
    p_job_id: jobId,
    p_owner_id: ownerId,
    p_request_id: requestId,
    p_error: reason,
  });
}

async function dispatchCanary(admin: BulkAdmin, job: JobRow, workerId: string): Promise<StepResult> {
  const requestId = generateShoplingPriceModifyRequestId();
  let context: Record<string, unknown>;
  try {
    context = record(await rpc(admin, "reserve_shopling_price_bulk_canary", {
      p_job_id: job.id,
      p_owner_id: job.owner_id,
      p_request_id: requestId,
    }));
  } catch (error) {
    return stopAuto(admin, job.id, job.owner_id, workerId, `첫 10개 시험 준비에 실패했습니다. ${text(error)}`, job.status);
  }

  const keys = goodsKeys(context.goods_keys);
  const dispatched = await dispatchShoplingPriceBulkCanary(keys, context.policy_overrides, requestId);
  if (dispatched.status === "queued") {
    const marked = await admin.rpc("mark_shopling_price_bulk_canary_running", {
      p_job_id: job.id,
      p_owner_id: job.owner_id,
      p_request_id: requestId,
      p_actions_url: dispatched.githubActionsUrl,
    });
    if (marked.error) {
      await blockUncertain(admin, "canary", job.id, job.owner_id, requestId, "GitHub 요청 수락 후 상태 저장이 불확실합니다.");
      return { outcome: "waiting", status: "dispatch_uncertain", message: "첫 10개 전송 상태를 확인하고 있습니다." };
    }
    return { outcome: "dispatched", status: "canary_running", message: "첫 10개 상품을 시험 실행하고 있습니다." };
  }

  if (dispatched.status === "rejected") {
    await rpc(admin, "reset_shopling_price_bulk_canary_rejected", {
      p_job_id: job.id,
      p_owner_id: job.owner_id,
      p_request_id: requestId,
      p_error: dispatched.message,
    });
    return stopAuto(admin, job.id, job.owner_id, workerId, `첫 10개 실행 요청이 거절되어 자동 실행을 멈췄습니다. ${dispatched.message}`, "prepared");
  }

  await blockUncertain(admin, "canary", job.id, job.owner_id, requestId, dispatched.message);
  return { outcome: "waiting", status: "dispatch_uncertain", message: "첫 10개 전송 여부를 확인하고 있습니다. 같은 요청 결과만 조회합니다." };
}

async function processCanaryResult(admin: BulkAdmin, job: JobRow, workerId: string, chunk: ChunkRow): Promise<StepResult> {
  const requestId = typeof chunk.request_id === "string" ? chunk.request_id : "";
  const keys = goodsKeys(chunk.goods_keys);
  if (!requestId || keys.length === 0) return stopAuto(admin, job.id, job.owner_id, workerId, "첫 10개 시험 요청 정보가 불완전해 자동 실행을 멈췄습니다.", job.status);

  const actions = await fetchShoplingPriceModifyActionsResult(requestId);
  if (actions.status === "pending") {
    const reconciliation = decideNormalDispatchingReconciliation({ chunkStatus: chunk.status, startedAt: chunk.started_at, now: Date.now() });
    if (reconciliation === "block_uncertain") {
      await blockUncertain(admin, "canary", job.id, job.owner_id, requestId, "전송 대기 상태가 120초 이상 지속되어 재전송을 차단합니다.");
      return { outcome: "waiting", status: "dispatch_uncertain", message: "첫 10개 전송 상태를 확인하고 있습니다." };
    }
    return { outcome: "waiting", status: job.status, message: "첫 10개 상품의 결과를 기다리고 있습니다." };
  }
  if (actions.status === "error" || !actions.summary) {
    return { outcome: "waiting", status: job.status, message: actions.message ?? "첫 10개 결과를 아직 확인하지 못했습니다." };
  }

  if (chunk.status === "dispatching") {
    await blockUncertain(admin, "canary", job.id, job.owner_id, requestId, "완료 결과를 찾았으므로 기존 요청을 불확실 상태에서 확정합니다.");
  }
  const analysis = analyzeShoplingPriceBulkCanaryResult(actions.summary, requestId, keys, actions.runConclusion);
  const finished = await admin.rpc("finish_shopling_price_bulk_canary", {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_request_id: requestId,
    p_success: analysis.success,
    p_failure_scope_known: analysis.failureScopeKnown,
    p_failed_keys: analysis.failedKeys,
    p_summary: actions.summary,
    p_run_url: actions.runUrl ?? null,
    p_error: analysis.success ? null : analysis.message,
  });
  if (finished.error) return stopAuto(admin, job.id, job.owner_id, workerId, `첫 10개 결과 저장에 실패했습니다. ${text(finished.error)}`, job.status);
  if (!analysis.success) return stopAuto(admin, job.id, job.owner_id, workerId, analysis.message, "canary_failed");
  return { outcome: "progressed", status: "canary_succeeded", message: "첫 10개 시험이 성공했습니다." };
}

async function approveNormal(admin: BulkAdmin, job: JobRow, workerId: string): Promise<StepResult> {
  const normalCount = await countChunks(admin, job.id, "normal");
  if (normalCount === 0) return finishAuto(admin, job.id, job.owner_id, workerId, "canary_succeeded");
  const approved = await admin.rpc("approve_shopling_price_bulk_normal_execution", {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
  });
  if (approved.error || !approved.data) return stopAuto(admin, job.id, job.owner_id, workerId, `나머지 상품 자동 실행 승인에 실패했습니다. ${text(approved.error)}`, job.status);
  return { outcome: "progressed", status: "normal_running", message: "나머지 상품 자동 실행을 시작합니다." };
}

async function dispatchNormal(admin: BulkAdmin, job: JobRow, workerId: string): Promise<StepResult> {
  const requestId = generateShoplingPriceModifyRequestId();
  const reserved = await admin.rpc("reserve_next_shopling_price_bulk_normal_chunk", {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_request_id: requestId,
  });
  if (reserved.error || !reserved.data) return stopAuto(admin, job.id, job.owner_id, workerId, `다음 50개 묶음을 준비하지 못했습니다. ${text(reserved.error)}`, job.status);
  const context = record(reserved.data);
  if (context.completed) return finishAuto(admin, job.id, job.owner_id, workerId, "normal_succeeded");
  if (context.paused) return { outcome: "noop", status: "normal_paused", message: "현재 작업은 일시중지되어 있습니다." };

  const keys = goodsKeys(context.goods_keys);
  const dispatched = await dispatchShoplingPriceBulkNormal(keys, context.policy_overrides, requestId);
  if (dispatched.status === "queued") {
    const marked = await admin.rpc("mark_shopling_price_bulk_normal_running", {
      p_job_id: job.id,
      p_owner_id: job.owner_id,
      p_request_id: requestId,
      p_actions_url: dispatched.githubActionsUrl,
    });
    if (marked.error) {
      await blockUncertain(admin, "normal", job.id, job.owner_id, requestId, "GitHub 요청 수락 후 상태 저장이 불확실합니다.");
      return { outcome: "waiting", status: "dispatch_uncertain", message: "현재 50개 묶음의 전송 상태를 확인하고 있습니다." };
    }
    return { outcome: "dispatched", status: "normal_running", message: `상품 ${keys.length}개를 자동 변경 중입니다.` };
  }

  const transition = dispatched.status === "rejected"
    ? "fail_shopling_price_bulk_normal_dispatch_rejected"
    : "block_shopling_price_bulk_normal_uncertain";
  await rpc(admin, transition, {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_request_id: requestId,
    p_error: dispatched.message,
  });
  if (dispatched.status === "rejected") return stopAuto(admin, job.id, job.owner_id, workerId, `50개 묶음 실행 요청이 거절되어 멈췄습니다. ${dispatched.message}`, "normal_failed");
  return { outcome: "waiting", status: "dispatch_uncertain", message: "현재 50개 묶음의 전송 여부를 확인하고 있습니다." };
}

async function processNormalResult(admin: BulkAdmin, job: JobRow, workerId: string, chunk: ChunkRow): Promise<StepResult> {
  const requestId = typeof chunk.request_id === "string" ? chunk.request_id : "";
  const keys = goodsKeys(chunk.goods_keys);
  if (!requestId || keys.length === 0) return stopAuto(admin, job.id, job.owner_id, workerId, "현재 실행 묶음의 요청 정보가 불완전해 멈췄습니다.", job.status);
  const actions = await fetchShoplingPriceModifyActionsResult(requestId);
  if (actions.status === "pending") {
    const reconciliation = decideNormalDispatchingReconciliation({ chunkStatus: chunk.status, startedAt: chunk.started_at, now: Date.now() });
    if (reconciliation === "block_uncertain") {
      await blockUncertain(admin, "normal", job.id, job.owner_id, requestId, "전송 대기 상태가 120초 이상 지속되어 재전송을 차단합니다.");
      return { outcome: "waiting", status: "dispatch_uncertain", message: "현재 묶음의 전송 상태를 확인하고 있습니다." };
    }
    return { outcome: "waiting", status: job.status, message: "현재 50개 묶음의 결과를 기다리고 있습니다." };
  }
  if (actions.status === "error" || !actions.summary) return { outcome: "waiting", status: job.status, message: actions.message ?? "현재 묶음 결과를 아직 확인하지 못했습니다." };
  if (chunk.status === "dispatching") await blockUncertain(admin, "normal", job.id, job.owner_id, requestId, "완료 결과를 찾았으므로 기존 요청을 불확실 상태에서 확정합니다.");

  const analysis = analyzeShoplingPriceBulkNormalResult(actions.summary, requestId, keys, actions.runConclusion);
  const finished = await admin.rpc("finish_shopling_price_bulk_normal_chunk", {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_request_id: requestId,
    p_success: analysis.success,
    p_failure_scope_known: analysis.failureScopeKnown,
    p_failed_keys: analysis.failedKeys,
    p_summary: actions.summary,
    p_run_url: actions.runUrl ?? null,
    p_error: analysis.success ? null : analysis.message,
  });
  if (finished.error || !finished.data) return stopAuto(admin, job.id, job.owner_id, workerId, `현재 묶음 결과 저장에 실패했습니다. ${text(finished.error)}`, job.status);
  if (!analysis.success) return stopAuto(admin, job.id, job.owner_id, workerId, analysis.message, "normal_failed");
  const state = record(finished.data);
  if (state.status === "normal_succeeded") return finishAuto(admin, job.id, job.owner_id, workerId, "normal_succeeded");
  return { outcome: "progressed", status: "normal_running", message: "현재 묶음이 성공했습니다. 다음 묶음을 준비합니다." };
}

async function dispatchRetry(admin: BulkAdmin, job: JobRow, workerId: string): Promise<StepResult> {
  const requestId = generateShoplingPriceModifyRequestId();
  const reserved = await admin.rpc("reserve_next_shopling_price_bulk_retry_chunk", {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_request_id: requestId,
  });
  if (reserved.error || !reserved.data) return stopAuto(admin, job.id, job.owner_id, workerId, `실패 상품 재실행 준비에 실패했습니다. ${text(reserved.error)}`, job.status);
  const context = record(reserved.data);
  if (context.completed) return { outcome: "progressed", status: String(context.status ?? "normal_running"), message: "실패 상품 재실행이 완료되었습니다." };
  if (context.paused) return { outcome: "noop", status: "retry_paused", message: "실패 상품 재실행이 일시중지되어 있습니다." };
  const keys = goodsKeys(context.goods_keys);
  const dispatched = await dispatchShoplingPriceBulkRetry(keys, context.policy_overrides, requestId);
  if (dispatched.status === "queued") {
    const marked = await admin.rpc("mark_shopling_price_bulk_retry_running", {
      p_job_id: job.id,
      p_owner_id: job.owner_id,
      p_request_id: requestId,
      p_actions_url: dispatched.githubActionsUrl,
    });
    if (marked.error) {
      await blockUncertain(admin, "retry", job.id, job.owner_id, requestId, "GitHub 요청 수락 후 상태 저장이 불확실합니다.");
      return { outcome: "waiting", status: "dispatch_uncertain", message: "실패 상품 재실행 전송 상태를 확인하고 있습니다." };
    }
    return { outcome: "dispatched", status: "retry_running", message: `실패 상품 ${keys.length}개를 다시 실행 중입니다.` };
  }
  const transition = dispatched.status === "rejected"
    ? "fail_shopling_price_bulk_retry_dispatch_rejected"
    : "block_shopling_price_bulk_retry_uncertain";
  await rpc(admin, transition, {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_request_id: requestId,
    p_error: dispatched.message,
  });
  if (dispatched.status === "rejected") return stopAuto(admin, job.id, job.owner_id, workerId, `실패 상품 재실행 요청이 거절됐습니다. ${dispatched.message}`, "retry_failed");
  return { outcome: "waiting", status: "dispatch_uncertain", message: "실패 상품 재실행 전송 여부를 확인하고 있습니다." };
}

async function processRetryResult(admin: BulkAdmin, job: JobRow, workerId: string, chunk: ChunkRow): Promise<StepResult> {
  const requestId = typeof chunk.request_id === "string" ? chunk.request_id : "";
  const keys = goodsKeys(chunk.goods_keys);
  if (!requestId || keys.length === 0) return stopAuto(admin, job.id, job.owner_id, workerId, "실패 상품 재실행 요청 정보가 불완전해 멈췄습니다.", job.status);
  const actions = await fetchShoplingPriceModifyActionsResult(requestId);
  if (actions.status === "pending") {
    const reconciliation = decideNormalDispatchingReconciliation({ chunkStatus: chunk.status, startedAt: chunk.started_at, now: Date.now() });
    if (reconciliation === "block_uncertain") {
      await blockUncertain(admin, "retry", job.id, job.owner_id, requestId, "전송 대기 상태가 120초 이상 지속되어 재전송을 차단합니다.");
      return { outcome: "waiting", status: "dispatch_uncertain", message: "실패 상품 재실행 전송 상태를 확인하고 있습니다." };
    }
    return { outcome: "waiting", status: job.status, message: "실패 상품 재실행 결과를 기다리고 있습니다." };
  }
  if (actions.status === "error" || !actions.summary) return { outcome: "waiting", status: job.status, message: actions.message ?? "재실행 결과를 아직 확인하지 못했습니다." };
  if (chunk.status === "dispatching") await blockUncertain(admin, "retry", job.id, job.owner_id, requestId, "완료 결과를 찾았으므로 기존 요청을 불확실 상태에서 확정합니다.");

  const analysis = analyzeShoplingPriceBulkRetryResult(actions.summary, requestId, keys, actions.runConclusion);
  const finished = await admin.rpc("finish_shopling_price_bulk_retry_chunk", {
    p_job_id: job.id,
    p_owner_id: job.owner_id,
    p_request_id: requestId,
    p_success: analysis.success,
    p_failure_scope_known: analysis.failureScopeKnown,
    p_failed_keys: analysis.failedKeys,
    p_summary: actions.summary,
    p_run_url: actions.runUrl ?? null,
    p_error: analysis.success ? null : analysis.message,
  });
  if (finished.error || !finished.data) return stopAuto(admin, job.id, job.owner_id, workerId, `재실행 결과 저장에 실패했습니다. ${text(finished.error)}`, job.status);
  if (!analysis.success) return stopAuto(admin, job.id, job.owner_id, workerId, analysis.message, "retry_failed");
  const state = record(finished.data);
  if (state.status === "normal_succeeded") return finishAuto(admin, job.id, job.owner_id, workerId, "normal_succeeded");
  return { outcome: "progressed", status: String(state.status ?? "normal_running"), message: "실패 상품 재실행이 성공했습니다." };
}

async function advanceOnce(admin: BulkAdmin, jobId: string, ownerId: string, workerId: string): Promise<StepResult> {
  const job = await loadJob(admin, jobId, ownerId);
  if (job.automation_mode !== "auto" || job.execution_mode !== "live" || job.archived_at) return { outcome: "noop", status: job.status, message: "자동 실행 대상이 아닙니다." };
  if (job.automation_worker_id !== workerId) return { outcome: "noop", status: job.status, message: "다른 자동 작업자가 처리 중입니다." };
  if (job.pause_requested || ["normal_paused", "retry_paused"].includes(job.status)) return { outcome: "noop", status: job.status, message: "현재 작업은 일시중지되어 있습니다." };
  if (["canary_failed", "normal_failed", "retry_failed", "cancelled", "validation_only"].includes(job.status)) return stopAuto(admin, job.id, job.owner_id, workerId, job.automation_stop_reason ?? "오류 상태에서 자동 실행을 멈췄습니다.", job.status);
  if (job.status === "normal_succeeded") return finishAuto(admin, job.id, job.owner_id, workerId, job.status);

  if (job.status === "prepared") return dispatchCanary(admin, job, workerId);
  if (["canary_dispatching", "canary_running"].includes(job.status)) {
    const active = await loadActiveChunks(admin, job.id, "canary");
    if (active.length !== 1) return stopAuto(admin, job.id, job.owner_id, workerId, "첫 10개 실행 상태를 하나로 확인할 수 없어 멈췄습니다.", job.status);
    return processCanaryResult(admin, job, workerId, active[0]);
  }
  if (job.status === "canary_succeeded") return approveNormal(admin, job, workerId);
  if (job.status === "normal_running") {
    const active = await loadActiveChunks(admin, job.id, "normal");
    if (active.length > 1) return stopAuto(admin, job.id, job.owner_id, workerId, "동시에 두 개 이상의 실행 묶음이 감지되어 멈췄습니다.", job.status);
    return active.length === 1 ? processNormalResult(admin, job, workerId, active[0]) : dispatchNormal(admin, job, workerId);
  }
  if (job.status === "retry_running") {
    const active = await loadActiveChunks(admin, job.id, "retry");
    if (active.length > 1) return stopAuto(admin, job.id, job.owner_id, workerId, "동시에 두 개 이상의 재실행 묶음이 감지되어 멈췄습니다.", job.status);
    return active.length === 1 ? processRetryResult(admin, job, workerId, active[0]) : dispatchRetry(admin, job, workerId);
  }
  if (job.status === "dispatch_uncertain") {
    const active = await loadActiveChunks(admin, job.id);
    if (active.length !== 1) return stopAuto(admin, job.id, job.owner_id, workerId, "전송 상태를 확인할 실행 묶음이 정확히 하나가 아니어서 멈췄습니다.", job.status);
    if (active[0].chunk_type === "canary") return processCanaryResult(admin, job, workerId, active[0]);
    if (active[0].chunk_type === "retry") return processRetryResult(admin, job, workerId, active[0]);
    return processNormalResult(admin, job, workerId, active[0]);
  }
  return { outcome: "noop", status: job.status, message: "현재 상태에서는 자동으로 진행할 작업이 없습니다." };
}

export async function runClaimedShoplingPriceBulkAutoJob(
  admin: BulkAdmin,
  {
    jobId,
    ownerId,
    workerId,
    maxTransitions = 4,
  }: {
    jobId: string;
    ownerId: string;
    workerId: string;
    maxTransitions?: number;
  },
): Promise<ShoplingPriceBulkAutoRunResult> {
  let transitions = 0;
  let final: StepResult = { outcome: "noop", message: "자동 실행 상태를 확인했습니다." };
  try {
    for (; transitions < Math.max(1, Math.min(maxTransitions, 4)); transitions += 1) {
      final = await advanceOnce(admin, jobId, ownerId, workerId);
      if (final.outcome !== "progressed") break;
    }
  } catch (error) {
    try {
      final = await stopAuto(admin, jobId, ownerId, workerId, `자동 실행 중 안전 오류가 발생해 멈췄습니다. ${text(error)}`);
    } catch {
      final = { outcome: "stopped", message: `자동 실행 중 오류가 발생했습니다. ${text(error)}` };
    }
  }

  return {
    jobId,
    transitions,
    outcome: final.outcome === "progressed" ? "waiting" : final.outcome,
    status: final.status,
    message: final.message,
    leaseReleased: final.leaseReleased === true,
  };
}
