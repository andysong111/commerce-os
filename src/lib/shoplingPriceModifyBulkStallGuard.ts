import type { BulkAdmin } from "@/lib/shoplingPriceModifyBulkApi";
import { buildShoplingPriceBulkHealth } from "@/lib/shoplingPriceModifyBulkHealth";

type JobRow = {
  id: string;
  owner_id: string;
  status: string;
  automation_worker_id?: string | null;
  automation_stop_reason?: string | null;
  automation_finished_at?: string | null;
  automation_last_tick_at?: string | null;
  updated_at?: string | null;
};

type ChunkRow = {
  chunk_index: number;
  chunk_type: "canary" | "normal" | "retry";
  status: string;
  request_id?: string | null;
  actions_url?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
};

export type ShoplingPriceBulkStallGuardResult = {
  stopped: boolean;
  leaseReleased: boolean;
  code: string;
  message: string;
  health?: ReturnType<typeof buildShoplingPriceBulkHealth>;
};

const rows = (value: unknown) => Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
const errorText = (value: unknown) => value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value ?? null);

export async function stopStalledShoplingPriceBulkAutoJob(
  admin: BulkAdmin,
  {
    jobId,
    ownerId,
    workerId,
    now = Date.now(),
  }: {
    jobId: string;
    ownerId: string;
    workerId: string;
    now?: number;
  },
): Promise<ShoplingPriceBulkStallGuardResult> {
  const jobResult = await admin.from("shopling_price_bulk_jobs")
    .select("id,owner_id,status,automation_worker_id,automation_stop_reason,automation_finished_at,automation_last_tick_at,updated_at")
    .eq("id", jobId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (jobResult.error) throw new Error(`stalled job query failed: ${errorText(jobResult.error)}`);
  if (!jobResult.data) return { stopped: false, leaseReleased: false, code: "JOB_NOT_FOUND", message: "작업을 찾지 못했습니다." };

  const job = jobResult.data as unknown as JobRow;
  if (job.automation_worker_id !== workerId) {
    return { stopped: false, leaseReleased: false, code: "WORKER_MISMATCH", message: "다른 자동 작업자가 처리 중입니다." };
  }
  if (job.automation_stop_reason || job.automation_finished_at) {
    return { stopped: false, leaseReleased: false, code: "ALREADY_STOPPED", message: "이미 중단되었거나 완료된 작업입니다." };
  }

  const chunksResult = await admin.from("shopling_price_bulk_chunks")
    .select("chunk_index,chunk_type,status,request_id,actions_url,started_at,updated_at")
    .eq("job_id", jobId)
    .in("status", ["dispatching", "running", "dispatch_uncertain"])
    .order("chunk_index", { ascending: true })
    .limit(2);
  if (chunksResult.error) throw new Error(`stalled chunk query failed: ${errorText(chunksResult.error)}`);
  const active = rows(chunksResult.data) as unknown as ChunkRow[];
  if (active.length !== 1) {
    return {
      stopped: false,
      leaseReleased: false,
      code: active.length === 0 ? "NO_ACTIVE_CHUNK" : "MULTIPLE_ACTIVE_CHUNKS",
      message: active.length === 0 ? "현재 실행 중인 묶음이 없습니다." : "동시에 여러 실행 묶음이 감지되었습니다.",
    };
  }

  const chunk = active[0];
  const health = buildShoplingPriceBulkHealth(job, chunk, now);
  if (!health.should_stop_automation || !["dispatching", "running"].includes(chunk.status)) {
    return { stopped: false, leaseReleased: false, code: health.code, message: health.message, health };
  }
  if (!chunk.request_id) {
    return { stopped: false, leaseReleased: false, code: "MISSING_REQUEST_ID", message: "장시간 정지 묶음의 요청번호가 없습니다.", health };
  }

  const blockRpc = chunk.chunk_type === "canary"
    ? "block_shopling_price_bulk_canary_uncertain"
    : chunk.chunk_type === "retry"
      ? "block_shopling_price_bulk_retry_uncertain"
      : "block_shopling_price_bulk_normal_uncertain";
  const reason = `${health.message} 중복 실행 방지를 위해 자동 진행을 안전 중단하고 같은 요청의 결과만 확인합니다.`;
  const blocked = await admin.rpc(blockRpc, {
    p_job_id: jobId,
    p_owner_id: ownerId,
    p_request_id: chunk.request_id,
    p_error: reason,
  });
  if (blocked.error) throw new Error(`${blockRpc}: ${errorText(blocked.error)}`);

  const stopped = await admin.rpc("stop_shopling_price_bulk_auto_job", {
    p_job_id: jobId,
    p_owner_id: ownerId,
    p_worker_id: workerId,
    p_reason: reason,
  });
  if (stopped.error) throw new Error(`stop_shopling_price_bulk_auto_job: ${errorText(stopped.error)}`);

  return {
    stopped: true,
    leaseReleased: true,
    code: "STALLED_AUTO_STOPPED",
    message: reason,
    health,
  };
}
