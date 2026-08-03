export const SHOPLING_PRICE_BULK_DELAY_WARNING_SECONDS = 10 * 60;
export const SHOPLING_PRICE_BULK_STALL_STOP_SECONDS = 30 * 60;
export const SHOPLING_PRICE_BULK_TICK_STALE_SECONDS = 5 * 60;

type JobHealthInput = {
  status?: unknown;
  automation_stop_reason?: unknown;
  automation_finished_at?: unknown;
  automation_last_tick_at?: unknown;
  updated_at?: unknown;
};

type ChunkHealthInput = {
  chunk_index?: unknown;
  chunk_type?: unknown;
  status?: unknown;
  request_id?: unknown;
  actions_url?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
} | null;

function timestamp(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function shoplingPriceBulkAgeSeconds(value: unknown, now = Date.now()) {
  const parsed = timestamp(value);
  if (parsed === null) return null;
  return Math.max(0, Math.floor((now - parsed) / 1000));
}

export function buildShoplingPriceBulkHealth(
  job: JobHealthInput,
  activeChunk: ChunkHealthInput,
  now = Date.now(),
) {
  const activeChunkAgeSeconds = shoplingPriceBulkAgeSeconds(activeChunk?.started_at, now);
  const activeChunkUpdateAgeSeconds = shoplingPriceBulkAgeSeconds(activeChunk?.updated_at, now);
  const automationLastTickAgeSeconds = shoplingPriceBulkAgeSeconds(job.automation_last_tick_at, now);
  const jobUpdateAgeSeconds = shoplingPriceBulkAgeSeconds(job.updated_at, now);
  const stopReason = typeof job.automation_stop_reason === "string" ? job.automation_stop_reason : null;
  const finished = typeof job.automation_finished_at === "string" && Boolean(job.automation_finished_at);
  const chunkStatus = typeof activeChunk?.status === "string" ? activeChunk.status : null;

  if (finished || job.status === "normal_succeeded") {
    return {
      code: "COMPLETED",
      severity: "ok",
      label: "완료",
      message: "가격 변경 작업이 완료되었습니다.",
      recommended_action: "추가 조치가 필요하지 않습니다.",
      should_stop_automation: false,
      active_chunk_age_seconds: activeChunkAgeSeconds,
      active_chunk_update_age_seconds: activeChunkUpdateAgeSeconds,
      automation_last_tick_age_seconds: automationLastTickAgeSeconds,
      job_update_age_seconds: jobUpdateAgeSeconds,
    };
  }

  if (stopReason) {
    return {
      code: activeChunk ? "STOPPED_RECONCILING" : "STOPPED",
      severity: "error",
      label: activeChunk ? "안전 중단·결과 확인 중" : "중단됨",
      message: stopReason,
      recommended_action: activeChunk
        ? "같은 요청의 결과가 확정될 때까지 새 작업을 시작하지 마세요. 진단정보를 복사해 전달하세요."
        : "중단 사유를 확인한 뒤 계속 실행 또는 보관을 선택하세요.",
      should_stop_automation: false,
      active_chunk_age_seconds: activeChunkAgeSeconds,
      active_chunk_update_age_seconds: activeChunkUpdateAgeSeconds,
      automation_last_tick_age_seconds: automationLastTickAgeSeconds,
      job_update_age_seconds: jobUpdateAgeSeconds,
    };
  }

  if (activeChunk && activeChunkAgeSeconds !== null && activeChunkAgeSeconds >= SHOPLING_PRICE_BULK_STALL_STOP_SECONDS) {
    return {
      code: "ACTIVE_CHUNK_STALLED",
      severity: "error",
      label: "장시간 정지 의심",
      message: `현재 실행 묶음이 ${Math.floor(activeChunkAgeSeconds / 60)}분 동안 완료되지 않았습니다.`,
      recommended_action: "자동 진행을 안전 중단하고 같은 요청의 결과만 확인해야 합니다.",
      should_stop_automation: ["dispatching", "running"].includes(chunkStatus ?? ""),
      active_chunk_age_seconds: activeChunkAgeSeconds,
      active_chunk_update_age_seconds: activeChunkUpdateAgeSeconds,
      automation_last_tick_age_seconds: automationLastTickAgeSeconds,
      job_update_age_seconds: jobUpdateAgeSeconds,
    };
  }

  if (activeChunk && activeChunkAgeSeconds !== null && activeChunkAgeSeconds >= SHOPLING_PRICE_BULK_DELAY_WARNING_SECONDS) {
    return {
      code: "ACTIVE_CHUNK_DELAYED",
      severity: "warning",
      label: "처리 지연",
      message: `현재 실행 묶음이 ${Math.floor(activeChunkAgeSeconds / 60)}분째 처리 중입니다.`,
      recommended_action: "정밀 상태 확인으로 요청번호와 마지막 갱신 시각을 확인하세요.",
      should_stop_automation: false,
      active_chunk_age_seconds: activeChunkAgeSeconds,
      active_chunk_update_age_seconds: activeChunkUpdateAgeSeconds,
      automation_last_tick_age_seconds: automationLastTickAgeSeconds,
      job_update_age_seconds: jobUpdateAgeSeconds,
    };
  }

  if (automationLastTickAgeSeconds !== null && automationLastTickAgeSeconds >= SHOPLING_PRICE_BULK_TICK_STALE_SECONDS) {
    return {
      code: "AUTOMATION_TICK_STALE",
      severity: "warning",
      label: "서버 확인 지연",
      message: `서버 자동 확인 기록이 ${Math.floor(automationLastTickAgeSeconds / 60)}분 동안 갱신되지 않았습니다.`,
      recommended_action: "정밀 상태 확인을 누르고 진단정보를 복사해 전달하세요.",
      should_stop_automation: false,
      active_chunk_age_seconds: activeChunkAgeSeconds,
      active_chunk_update_age_seconds: activeChunkUpdateAgeSeconds,
      automation_last_tick_age_seconds: automationLastTickAgeSeconds,
      job_update_age_seconds: jobUpdateAgeSeconds,
    };
  }

  return {
    code: activeChunk ? "RUNNING" : "WAITING_NEXT_STEP",
    severity: "ok",
    label: activeChunk ? "정상 처리 중" : "다음 단계 대기",
    message: activeChunk ? "현재 실행 묶음의 결과를 기다리고 있습니다." : "서버가 다음 실행 단계를 준비하고 있습니다.",
    recommended_action: "현재 상태를 유지하세요.",
    should_stop_automation: false,
    active_chunk_age_seconds: activeChunkAgeSeconds,
    active_chunk_update_age_seconds: activeChunkUpdateAgeSeconds,
    automation_last_tick_age_seconds: automationLastTickAgeSeconds,
    job_update_age_seconds: jobUpdateAgeSeconds,
  };
}
