import { createHash, randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  listSeoRunJobs,
  patchOwnedSeoRunJobs,
  type SeoRunJobContext,
} from "@/lib/seoRunJobServer";

const TABLE = "shopling_market_auto_orchestrations";
const SEO_TABLE = "seo_run_jobs";
const UPLOAD_TABLE = "product_launch_upload_jobs";
const LEDGER_TABLE = "shopling_market_pipeline_ledger";
export const MARKET_AUTO_AGENT_BRIDGE = "shopling-market-auto-agent-v0.1";
const LEASE_SECONDS = 180;
const CHUNK_SIZE = 20;
const TERMINAL_STATES = new Set([
  "completed",
  "completed_with_exceptions",
  "exception",
  "cancelled",
]);

type UnknownRecord = Record<string, unknown>;
type AdminClient = NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function uniqueIds(value: unknown, limit = 250) {
  return [...new Set(array(value).map(text).filter((value) => value && value.length <= 180))].slice(0, limit);
}

function validUuid(value: unknown) {
  const normalized = text(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : "";
}

export function validMarketAutoAgentId(value: unknown) {
  const normalized = text(value);
  return /^[A-Za-z0-9._:-]{12,180}$/.test(normalized) ? normalized : "";
}

export function validMarketAutoToken(value: unknown) {
  const normalized = text(value);
  return /^[A-Za-z0-9_-]{32,180}$/.test(normalized) ? normalized : "";
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function leaseIso(seconds = LEASE_SECONDS) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function registrationJobIds(rows: UnknownRecord[]) {
  return [...new Set(
    rows
      .filter((row) => text(row.registration_status) === "success")
      .map((row) => validUuid(row.registration_job_id))
      .filter(Boolean),
  )];
}

function jobGoodsKeys(job: UnknownRecord) {
  return [...new Set(
    array(record(job.result).rows)
      .map(record)
      .filter((row) => text(row.status) === "success")
      .map((row) => text(row.goods_key || row.goodsKey))
      .filter((key) => /^\d{5,9}$/.test(key)),
  )].slice(0, 6);
}

async function requireAdmin() {
  const supabase = await createSupabaseAdminClient();
  if (!supabase) throw new Error("supabase_admin_unavailable");
  return supabase;
}

async function readByToken(token: string) {
  const supabase = await requireAdmin();
  const result = await supabase
    .from(TABLE)
    .select("*")
    .eq("token_hash", hashToken(token))
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return { supabase, row: result.data ? record(result.data) : null };
}

async function readSeoRows(supabase: AdminClient, ownerId: string, runIds: string[]) {
  if (!runIds.length) return [] as UnknownRecord[];
  const result = await supabase
    .from(SEO_TABLE)
    .select("run_id,batch_id,model_number,registration_status,registration_job_id,error_message,updated_at")
    .eq("owner_id", ownerId)
    .in("run_id", runIds)
    .limit(Math.max(1, runIds.length));
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []).map(record);
}

async function patchOrchestration(supabase: AdminClient, id: string, patch: UnknownRecord) {
  const result = await supabase
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? record(result.data) : null;
}

export async function computeMarketSummary(
  supabase: AdminClient,
  ownerId: string,
  seoRows: UnknownRecord[],
) {
  const successfulJobIds = registrationJobIds(seoRows);
  const failedUploadRunIds = seoRows
    .filter((row) => text(row.registration_status) === "failed")
    .map((row) => text(row.run_id))
    .filter(Boolean);
  if (!successfulJobIds.length) {
    return {
      terminal: failedUploadRunIds.length > 0,
      successfulJobIds,
      failedUploadRunIds,
      products: [] as Array<UnknownRecord>,
      completedProducts: 0,
      exceptionProducts: 0,
      busyProducts: 0,
    };
  }

  const jobsResult = await supabase
    .from(UPLOAD_TABLE)
    .select("id,owner_id,status,result")
    .eq("owner_id", ownerId)
    .in("id", successfulJobIds)
    .limit(successfulJobIds.length);
  if (jobsResult.error) throw new Error(jobsResult.error.message);
  const jobs = (Array.isArray(jobsResult.data) ? jobsResult.data : []).map(record);
  const allGoodsKeys = [...new Set(jobs.flatMap(jobGoodsKeys))];
  const ledgerRows: UnknownRecord[] = [];
  if (allGoodsKeys.length) {
    const ledgerResult = await supabase
      .from(LEDGER_TABLE)
      .select("goods_key,status,market_status")
      .eq("owner_id", ownerId)
      .in("goods_key", allGoodsKeys)
      .limit(Math.max(6, allGoodsKeys.length));
    if (ledgerResult.error) throw new Error(ledgerResult.error.message);
    ledgerRows.push(...(Array.isArray(ledgerResult.data) ? ledgerResult.data : []).map(record));
  }
  const ledgerByKey = new Map(ledgerRows.map((row) => [text(row.goods_key), row] as const));

  const products = jobs.map((job) => {
    const jobId = text(job.id);
    const goodsKeys = jobGoodsKeys(job);
    const rows = goodsKeys.map((key) => ledgerByKey.get(key)).filter(Boolean) as UnknownRecord[];
    const done = rows.filter((row) =>
      ["sent", "already_registered"].includes(text(row.status)) ||
      ["sent", "already_registered"].includes(text(row.market_status)),
    ).length;
    const confirm = rows.filter((row) =>
      text(row.status) === "confirm_needed" || text(row.market_status) === "confirm_needed",
    ).length;
    const busy = rows.filter((row) =>
      text(row.status) === "claimed" || text(row.market_status) === "submit_armed",
    ).length;
    const pending = rows.filter((row) =>
      text(row.status) === "queued" && text(row.market_status) === "pending",
    ).length;
    const terminal = goodsKeys.length === 6 && rows.length === 6 && done + confirm >= 6 && busy === 0 && pending === 0;
    return { jobId, goodsKeys, done, confirm, busy, pending, terminal };
  });
  const completedProducts = products.filter((row) => row.terminal && row.done === 6).length;
  const exceptionProducts = products.filter((row) => row.terminal && row.done < 6).length;
  const missingJobIds = successfulJobIds.filter((jobId) => !products.some((row) => row.jobId === jobId));
  const busyProducts = products.filter((row) => !row.terminal).length + missingJobIds.length;
  const terminal = products.length === successfulJobIds.length && busyProducts === 0;
  return {
    terminal,
    successfulJobIds,
    failedUploadRunIds,
    products,
    completedProducts,
    exceptionProducts,
    busyProducts,
    missingJobIds,
  };
}

function remainingMarketJobIds(summary: Awaited<ReturnType<typeof computeMarketSummary>>) {
  const unfinished = summary.products
    .filter((row) => row.terminal !== true)
    .map((row) => text(row.jobId))
    .filter(Boolean);
  const missing = Array.isArray(summary.missingJobIds) ? summary.missingJobIds.map(text).filter(Boolean) : [];
  return [...new Set([...unfinished, ...missing])].slice(0, CHUNK_SIZE);
}

async function completeIfTerminal(
  supabase: AdminClient,
  orchestrationId: string,
  summary: Awaited<ReturnType<typeof computeMarketSummary>>,
) {
  if (!summary.terminal) return null;
  const state = summary.failedUploadRunIds.length || summary.exceptionProducts
    ? "completed_with_exceptions"
    : "completed";
  await patchOrchestration(supabase, orchestrationId, {
    state,
    completed_at: new Date().toISOString(),
    lease_until: null,
    error_message: state === "completed" ? "" : "일부 Shopling 업로드 또는 마켓 채널이 확인필요로 종료되었습니다.",
    result: summary,
  });
  return { state, summary };
}

export async function createMarketAutoOrchestration(context: SeoRunJobContext, rawRunIds: unknown) {
  const runIds = uniqueIds(rawRunIds);
  if (!runIds.length) throw new Error("원클릭 등록 대상으로 선택할 SEO RUN이 없습니다.");
  const current = await listSeoRunJobs(context, {
    runIds,
    includeArchived: false,
    limit: runIds.length,
  });
  const accepted = current.filter(
    (job) => job.status === "ready" && job.registration_status !== "failed",
  );
  if (!accepted.length) throw new Error("FINAL 완료 상태의 Shopling 등록 가능 RUN이 없습니다.");

  const token = randomBytes(32).toString("base64url");
  const supabase = await requireAdmin();
  const acceptedRunIds = accepted.map((job) => job.run_id);
  const batchIds = [...new Set(accepted.map((job) => text(job.batch_id)).filter(Boolean))];
  const insertResult = await supabase
    .from(TABLE)
    .insert({
      owner_id: context.identity.userId,
      owner_email: context.identity.email,
      batch_id: batchIds.length === 1 ? batchIds[0] : `mixed-${crypto.randomUUID()}`,
      run_ids: acceptedRunIds,
      token_hash: hashToken(token),
      state: accepted.some((job) => job.registration_status === "success") ? "uploading" : "waiting_upload",
      result: { requestedCount: runIds.length, acceptedCount: acceptedRunIds.length },
    })
    .select("id,state,created_at")
    .limit(1)
    .maybeSingle();
  if (insertResult.error || !insertResult.data) {
    throw new Error(insertResult.error?.message || "원클릭 작업 생성 실패");
  }
  const inserted = record(insertResult.data);
  const orchestrationId = text(inserted.id);
  const queueRunIds = accepted
    .filter((job) => job.registration_status === "idle")
    .map((job) => job.run_id);
  try {
    if (queueRunIds.length) {
      await patchOwnedSeoRunJobs(context, queueRunIds, {
        registration_status: "queued",
        registration_job_id: "",
        registration_request_id: "",
      });
    }
  } catch (error) {
    await patchOrchestration(supabase, orchestrationId, {
      state: "exception",
      completed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : "Shopling 업로드 큐 연결 실패",
    }).catch(() => null);
    throw error;
  }
  return {
    orchestrationId,
    state: text(inserted.state) || "waiting_upload",
    handoffToken: token,
    requestedCount: runIds.length,
    acceptedCount: acceptedRunIds.length,
    uploadQueuedCount: queueRunIds.length,
    skippedCount: Math.max(0, runIds.length - acceptedRunIds.length),
    needsWorkerWake: queueRunIds.length > 0 || accepted.some((job) => ["submitting", "queued", "running"].includes(job.registration_status)),
  };
}

export async function listMarketAutoOrchestrations(ownerId: string) {
  const supabase = await requireAdmin();
  const result = await supabase
    .from(TABLE)
    .select("id,batch_id,run_ids,state,agent_id,lease_until,heartbeat_at,market_started_at,completed_at,error_message,result,created_at,updated_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (result.error) throw new Error(result.error.message);
  return Array.isArray(result.data) ? result.data : [];
}

export async function pollMarketAutoAgent(token: string, agentId: string) {
  const found = await readByToken(token);
  if (!found.row) throw new Error("market_auto_token_not_found");
  const row = found.row;
  const orchestrationId = text(row.id);
  const state = text(row.state);
  if (TERMINAL_STATES.has(state)) {
    return { terminal: true, ready: false, state, orchestrationId, result: record(row.result) };
  }
  const ownerId = text(row.owner_id);
  const runIds = uniqueIds(row.run_ids);
  const seoRows = await readSeoRows(found.supabase, ownerId, runIds);
  const pendingUploads = seoRows.filter((job) => !["success", "failed"].includes(text(job.registration_status)));
  const successfulJobIds = registrationJobIds(seoRows);
  const failedUploadRunIds = seoRows.filter((job) => text(job.registration_status) === "failed").map((job) => text(job.run_id)).filter(Boolean);
  if (pendingUploads.length) {
    if (!["market_claimed", "market_running"].includes(state)) {
      await patchOrchestration(found.supabase, orchestrationId, {
        state: successfulJobIds.length ? "uploading" : "waiting_upload",
        result: { uploadReadyCount: successfulJobIds.length, uploadPendingCount: pendingUploads.length, failedUploadRunIds },
      });
    }
    return {
      terminal: false,
      ready: false,
      state: "uploading",
      orchestrationId,
      uploadReadyCount: successfulJobIds.length,
      uploadPendingCount: pendingUploads.length,
      failedUploadRunIds,
    };
  }

  const summary = await computeMarketSummary(found.supabase, ownerId, seoRows);
  const completed = await completeIfTerminal(found.supabase, orchestrationId, summary);
  if (completed) {
    return { terminal: true, ready: false, orchestrationId, ...completed };
  }
  if (!successfulJobIds.length) {
    await patchOrchestration(found.supabase, orchestrationId, {
      state: "exception",
      completed_at: new Date().toISOString(),
      error_message: "마켓전송 가능한 Shopling 업로드 성공 건이 없습니다.",
      result: summary,
    });
    return { terminal: true, ready: false, state: "exception", orchestrationId, result: summary };
  }

  const jobIds = remainingMarketJobIds(summary);
  if (!jobIds.length) {
    return { terminal: false, ready: false, state: "market_ready", orchestrationId, result: summary };
  }
  const leaseUntil = Date.parse(text(row.lease_until));
  const leaseActive = Number.isFinite(leaseUntil) && leaseUntil > Date.now();
  const currentAgent = text(row.agent_id);
  if (leaseActive && currentAgent && currentAgent !== agentId) {
    return { terminal: false, ready: false, busy: true, state, orchestrationId };
  }
  await patchOrchestration(found.supabase, orchestrationId, {
    state: state === "market_running" ? "market_running" : "market_claimed",
    agent_id: agentId,
    lease_until: leaseIso(),
    heartbeat_at: new Date().toISOString(),
    market_started_at: row.market_started_at || new Date().toISOString(),
    result: summary,
  });
  return {
    terminal: false,
    ready: true,
    resume: ["market_claimed", "market_running"].includes(state),
    state: "market_claimed",
    orchestrationId,
    jobIds,
    failedUploadRunIds,
    leaseSeconds: LEASE_SECONDS,
  };
}

export async function heartbeatMarketAutoAgent(token: string, agentId: string) {
  const found = await readByToken(token);
  if (!found.row) throw new Error("market_auto_token_not_found");
  const row = found.row;
  const state = text(row.state);
  if (TERMINAL_STATES.has(state)) return { terminal: true, state, orchestrationId: text(row.id) };
  const leaseUntil = Date.parse(text(row.lease_until));
  const currentAgent = text(row.agent_id);
  if (currentAgent && currentAgent !== agentId && Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
    throw new Error("market_auto_agent_lease_mismatch");
  }
  await patchOrchestration(found.supabase, text(row.id), {
    state: "market_running",
    agent_id: agentId,
    lease_until: leaseIso(),
    heartbeat_at: new Date().toISOString(),
    market_started_at: row.market_started_at || new Date().toISOString(),
  });
  return { terminal: false, state: "market_running", orchestrationId: text(row.id), leaseSeconds: LEASE_SECONDS };
}

export async function reportMarketAutoAgent(token: string, agentId: string) {
  const found = await readByToken(token);
  if (!found.row) throw new Error("market_auto_token_not_found");
  const row = found.row;
  const leaseUntil = Date.parse(text(row.lease_until));
  const currentAgent = text(row.agent_id);
  if (currentAgent && currentAgent !== agentId && Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
    throw new Error("market_auto_agent_lease_mismatch");
  }
  const seoRows = await readSeoRows(found.supabase, text(row.owner_id), uniqueIds(row.run_ids));
  const summary = await computeMarketSummary(found.supabase, text(row.owner_id), seoRows);
  const completed = await completeIfTerminal(found.supabase, text(row.id), summary);
  if (completed) return { terminal: true, orchestrationId: text(row.id), ...completed };
  await patchOrchestration(found.supabase, text(row.id), {
    state: "market_ready",
    agent_id: agentId,
    lease_until: null,
    heartbeat_at: new Date().toISOString(),
    result: summary,
  });
  return { terminal: false, state: "market_ready", orchestrationId: text(row.id), result: summary };
}
