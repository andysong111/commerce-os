import { createHash, randomBytes } from "node:crypto";
import { after, NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { wakeOpsDispatchTask } from "@/lib/opsAdaptiveDispatcher";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import {
  listSeoRunJobs,
  patchOwnedSeoRunJobs,
} from "@/lib/seoRunJobServer";
import { runCoalescedSeoRunShoplingWorkerPulse } from "@/lib/seoRunShoplingWorkerPulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TABLE = "shopling_market_auto_orchestrations";
const SEO_TABLE = "seo_run_jobs";
const UPLOAD_TABLE = "product_launch_upload_jobs";
const LEDGER_TABLE = "shopling_market_pipeline_ledger";
const AGENT_BRIDGE = "shopling-market-auto-agent-v0.1";
const LEASE_SECONDS = 180;
const TERMINAL_STATES = new Set([
  "completed",
  "completed_with_exceptions",
  "exception",
  "cancelled",
]);

type UnknownRecord = Record<string, unknown>;

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

function ids(value: unknown, limit = 250) {
  return [...new Set(array(value).map(text).filter((value) => value && value.length <= 180))].slice(0, limit);
}

function validUuid(value: unknown) {
  const normalized = text(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : "";
}

function validAgentId(value: unknown) {
  const normalized = text(value);
  return /^[A-Za-z0-9._:-]{12,180}$/.test(normalized) ? normalized : "";
}

function validToken(value: unknown) {
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

async function scheduleShoplingRegistrationWorker(userId: string) {
  await wakeOpsDispatchTask("seo-run-worker", 0).catch(() => false);
  await runCoalescedSeoRunShoplingWorkerPulse({
    workerId: `one-click:${userId.slice(0, 8)}:${crypto.randomUUID()}`,
    leaseSeconds: 150,
  }).catch((error) => {
    console.error("[shopling-market-auto] Shopling registration worker failed", error);
  });
}

async function readByToken(token: string) {
  const supabase = await createSupabaseAdminClient();
  if (!supabase) return { supabase: null, row: null, error: "supabase_admin_unavailable" };
  const result = await supabase
    .from(TABLE)
    .select("*")
    .eq("token_hash", hashToken(token))
    .limit(1)
    .maybeSingle();
  return {
    supabase,
    row: result.data ? record(result.data) : null,
    error: result.error?.message || "",
  };
}

async function readSeoRows(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>, ownerId: string, runIds: string[]) {
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

async function computeMarketSummary(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>,
  ownerId: string,
  seoRows: UnknownRecord[],
) {
  const successfulJobIds = registrationJobIds(seoRows);
  const failedUploads = seoRows.filter((row) => text(row.registration_status) === "failed");
  if (!successfulJobIds.length) {
    return {
      terminal: failedUploads.length > 0,
      successfulJobIds,
      failedUploadRunIds: failedUploads.map((row) => text(row.run_id)).filter(Boolean),
      products: [],
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
  const ledgerResult = allGoodsKeys.length
    ? await supabase
        .from(LEDGER_TABLE)
        .select("goods_key,status,market_status")
        .eq("owner_id", ownerId)
        .in("goods_key", allGoodsKeys)
        .limit(Math.max(6, allGoodsKeys.length))
    : { data: [], error: null };
  if (ledgerResult.error) throw new Error(ledgerResult.error.message);
  const ledgerByKey = new Map(
    (Array.isArray(ledgerResult.data) ? ledgerResult.data : []).map((raw) => {
      const row = record(raw);
      return [text(row.goods_key), row] as const;
    }),
  );

  const products = jobs.map((job) => {
    const jobId = text(job.id);
    const keys = jobGoodsKeys(job);
    const rows = keys.map((key) => ledgerByKey.get(key)).filter(Boolean) as UnknownRecord[];
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
    const sixValid = keys.length === 6;
    const terminal = sixValid && rows.length === 6 && done + confirm >= 6 && busy === 0 && pending === 0;
    return { jobId, goodsKeys: keys, done, confirm, busy, pending, terminal };
  });
  const completedProducts = products.filter((row) => row.terminal && row.done === 6).length;
  const exceptionProducts = products.filter((row) => row.terminal && row.done < 6).length;
  const busyProducts = products.filter((row) => !row.terminal).length;
  const terminal = products.length === successfulJobIds.length && busyProducts === 0;
  return {
    terminal,
    successfulJobIds,
    failedUploadRunIds: failedUploads.map((row) => text(row.run_id)).filter(Boolean),
    products,
    completedProducts,
    exceptionProducts,
    busyProducts,
  };
}

async function patchOrchestration(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>,
  id: string,
  patch: UnknownRecord,
) {
  const updatedAt = new Date().toISOString();
  const result = await supabase
    .from(TABLE)
    .update({ ...patch, updated_at: updatedAt })
    .eq("id", id)
    .select("*")
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? record(result.data) : null;
}

async function agentPoll(token: string, agentId: string) {
  const found = await readByToken(token);
  if (!found.supabase) return Response.json({ ok: false, error: found.error }, { status: 503 });
  if (found.error) return Response.json({ ok: false, error: "market_auto_read_failed", message: found.error }, { status: 503 });
  if (!found.row) return Response.json({ ok: false, error: "market_auto_token_not_found" }, { status: 404 });
  const row = found.row;
  const orchestrationId = text(row.id);
  const ownerId = text(row.owner_id);
  const runIds = ids(row.run_ids);
  const state = text(row.state);
  if (TERMINAL_STATES.has(state)) {
    return Response.json({ ok: true, bridge: AGENT_BRIDGE, terminal: true, state, orchestrationId, result: record(row.result) });
  }
  const seoRows = await readSeoRows(found.supabase, ownerId, runIds);
  const pendingUploads = seoRows.filter((job) => !["success", "failed"].includes(text(job.registration_status)));
  const successfulJobIds = registrationJobIds(seoRows);
  const failedUploadRunIds = seoRows
    .filter((job) => text(job.registration_status) === "failed")
    .map((job) => text(job.run_id))
    .filter(Boolean);

  if (pendingUploads.length) {
    if (!["market_claimed", "market_running"].includes(state)) {
      await patchOrchestration(found.supabase, orchestrationId, {
        state: successfulJobIds.length ? "uploading" : "waiting_upload",
        result: {
          uploadReadyCount: successfulJobIds.length,
          uploadPendingCount: pendingUploads.length,
          failedUploadRunIds,
        },
      });
    }
    return Response.json({
      ok: true,
      bridge: AGENT_BRIDGE,
      terminal: false,
      ready: false,
      orchestrationId,
      state: "uploading",
      uploadReadyCount: successfulJobIds.length,
      uploadPendingCount: pendingUploads.length,
      failedUploadRunIds,
    });
  }

  const summary = await computeMarketSummary(found.supabase, ownerId, seoRows);
  if (summary.terminal) {
    const nextState = summary.failedUploadRunIds.length || summary.exceptionProducts
      ? "completed_with_exceptions"
      : "completed";
    await patchOrchestration(found.supabase, orchestrationId, {
      state: nextState,
      completed_at: new Date().toISOString(),
      lease_until: null,
      result: summary,
      error_message: nextState === "completed" ? "" : "일부 Shopling 업로드 또는 마켓 채널이 확인필요로 종료되었습니다.",
    });
    return Response.json({ ok: true, bridge: AGENT_BRIDGE, terminal: true, state: nextState, orchestrationId, result: summary });
  }

  if (!successfulJobIds.length) {
    const result = { ...summary, failedUploadRunIds };
    await patchOrchestration(found.supabase, orchestrationId, {
      state: "exception",
      completed_at: new Date().toISOString(),
      error_message: "마켓전송 가능한 Shopling 업로드 성공 건이 없습니다.",
      result,
    });
    return Response.json({ ok: true, bridge: AGENT_BRIDGE, terminal: true, state: "exception", orchestrationId, result });
  }

  const leaseUntil = Date.parse(text(row.lease_until));
  const leaseActive = Number.isFinite(leaseUntil) && leaseUntil > Date.now();
  const currentAgent = text(row.agent_id);
  if (leaseActive && currentAgent && currentAgent !== agentId) {
    return Response.json({ ok: true, bridge: AGENT_BRIDGE, terminal: false, ready: false, busy: true, orchestrationId, state });
  }
  const next = await patchOrchestration(found.supabase, orchestrationId, {
    state: state === "market_running" ? "market_running" : "market_claimed",
    agent_id: agentId,
    lease_until: leaseIso(),
    heartbeat_at: new Date().toISOString(),
    market_started_at: row.market_started_at || new Date().toISOString(),
    result: { ...summary, failedUploadRunIds },
  });
  return Response.json({
    ok: true,
    bridge: AGENT_BRIDGE,
    terminal: false,
    ready: true,
    resume: ["market_claimed", "market_running"].includes(state),
    orchestrationId,
    state: text(next?.state) || "market_claimed",
    jobIds: successfulJobIds,
    failedUploadRunIds,
    leaseSeconds: LEASE_SECONDS,
  });
}

async function agentHeartbeat(token: string, agentId: string) {
  const found = await readByToken(token);
  if (!found.supabase) return Response.json({ ok: false, error: found.error }, { status: 503 });
  if (!found.row) return Response.json({ ok: false, error: "market_auto_token_not_found" }, { status: 404 });
  const row = found.row;
  if (TERMINAL_STATES.has(text(row.state))) {
    return Response.json({ ok: true, bridge: AGENT_BRIDGE, terminal: true, state: text(row.state), orchestrationId: text(row.id) });
  }
  const currentAgent = text(row.agent_id);
  const leaseUntil = Date.parse(text(row.lease_until));
  if (currentAgent && currentAgent !== agentId && Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
    return Response.json({ ok: false, error: "market_auto_agent_lease_mismatch" }, { status: 409 });
  }
  const updated = await patchOrchestration(found.supabase, text(row.id), {
    state: "market_running",
    agent_id: agentId,
    lease_until: leaseIso(),
    heartbeat_at: new Date().toISOString(),
    market_started_at: row.market_started_at || new Date().toISOString(),
  });
  return Response.json({ ok: true, bridge: AGENT_BRIDGE, terminal: false, state: text(updated?.state), orchestrationId: text(row.id), leaseSeconds: LEASE_SECONDS });
}

async function agentReport(token: string, agentId: string) {
  const found = await readByToken(token);
  if (!found.supabase) return Response.json({ ok: false, error: found.error }, { status: 503 });
  if (!found.row) return Response.json({ ok: false, error: "market_auto_token_not_found" }, { status: 404 });
  const row = found.row;
  const ownerId = text(row.owner_id);
  const runIds = ids(row.run_ids);
  const currentAgent = text(row.agent_id);
  const leaseUntil = Date.parse(text(row.lease_until));
  if (currentAgent && currentAgent !== agentId && Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
    return Response.json({ ok: false, error: "market_auto_agent_lease_mismatch" }, { status: 409 });
  }
  const seoRows = await readSeoRows(found.supabase, ownerId, runIds);
  const summary = await computeMarketSummary(found.supabase, ownerId, seoRows);
  if (!summary.terminal) {
    await patchOrchestration(found.supabase, text(row.id), {
      state: "market_running",
      agent_id: agentId,
      lease_until: leaseIso(),
      heartbeat_at: new Date().toISOString(),
      result: summary,
    });
    return Response.json({ ok: true, bridge: AGENT_BRIDGE, terminal: false, state: "market_running", orchestrationId: text(row.id), result: summary });
  }
  const nextState = summary.failedUploadRunIds.length || summary.exceptionProducts
    ? "completed_with_exceptions"
    : "completed";
  await patchOrchestration(found.supabase, text(row.id), {
    state: nextState,
    agent_id: agentId,
    lease_until: null,
    heartbeat_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    error_message: nextState === "completed" ? "" : "일부 Shopling 업로드 또는 마켓 채널이 확인필요로 종료되었습니다.",
    result: summary,
  });
  return Response.json({ ok: true, bridge: AGENT_BRIDGE, terminal: true, state: nextState, orchestrationId: text(row.id), result: summary });
}

export async function GET(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const supabase = await createSupabaseAdminClient();
  if (!supabase) return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });
  const result = await supabase
    .from(TABLE)
    .select("id,batch_id,run_ids,state,agent_id,lease_until,heartbeat_at,market_started_at,completed_at,error_message,result,created_at,updated_at")
    .eq("owner_id", authenticated.value.identity.userId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (result.error) return Response.json({ ok: false, error: "market_auto_list_failed", message: result.error.message }, { status: 503 });
  return Response.json({ ok: true, orchestrations: Array.isArray(result.data) ? result.data : [] });
}

export async function POST(request: NextRequest) {
  const body = record(await request.json().catch(() => ({})));
  const action = text(body.action) || "create";

  if (["agent_poll", "agent_heartbeat", "agent_report"].includes(action)) {
    if (text(body.bridge) !== AGENT_BRIDGE) {
      return Response.json({ ok: false, error: "unsupported_market_auto_agent_bridge" }, { status: 400 });
    }
    const token = validToken(body.token);
    const agentId = validAgentId(body.agentId);
    if (!token || !agentId) return Response.json({ ok: false, error: "invalid_market_auto_agent_identity" }, { status: 400 });
    if (action === "agent_poll") return agentPoll(token, agentId);
    if (action === "agent_heartbeat") return agentHeartbeat(token, agentId);
    return agentReport(token, agentId);
  }

  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  if (action !== "create") return Response.json({ ok: false, error: "unsupported_market_auto_action" }, { status: 400 });
  const runIds = ids(body.runIds);
  if (!runIds.length) return Response.json({ ok: false, error: "market_auto_run_ids_required", message: "원클릭 등록 대상으로 선택할 SEO RUN이 없습니다." }, { status: 400 });
  const context = authenticated.value;
  const current = await listSeoRunJobs(context, { runIds, includeArchived: false, limit: runIds.length });
  const accepted = current.filter((job) =>
    job.status === "ready" && !["failed"].includes(job.registration_status),
  );
  if (!accepted.length) {
    return Response.json({ ok: false, error: "market_auto_no_eligible_runs", message: "FINAL 완료 상태의 Shopling 등록 가능 RUN이 없습니다." }, { status: 409 });
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const supabase = await createSupabaseAdminClient();
  if (!supabase) return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });
  const acceptedIds = accepted.map((job) => job.run_id);
  const batchIds = [...new Set(accepted.map((job) => text(job.batch_id)).filter(Boolean))];
  const inserted = await supabase
    .from(TABLE)
    .insert({
      owner_id: context.identity.userId,
      owner_email: context.identity.email,
      batch_id: batchIds.length === 1 ? batchIds[0] : `mixed-${crypto.randomUUID()}`,
      run_ids: acceptedIds,
      token_hash: tokenHash,
      state: accepted.some((job) => job.registration_status === "success") ? "uploading" : "waiting_upload",
      result: { requestedCount: runIds.length, acceptedCount: acceptedIds.length },
    })
    .select("id,state,created_at")
    .limit(1)
    .maybeSingle();
  if (inserted.error || !inserted.data) {
    return Response.json({ ok: false, error: "market_auto_create_failed", message: inserted.error?.message || "원클릭 작업 생성 실패" }, { status: 503 });
  }

  const uploadQueueIds = accepted
    .filter((job) => job.registration_status === "idle")
    .map((job) => job.run_id);
  try {
    if (uploadQueueIds.length) {
      await patchOwnedSeoRunJobs(context, uploadQueueIds, {
        registration_status: "queued",
        registration_job_id: "",
        registration_request_id: "",
      });
      after(() => scheduleShoplingRegistrationWorker(context.identity.userId));
    } else if (accepted.some((job) => ["queued", "running", "submitting"].includes(job.registration_status))) {
      after(() => scheduleShoplingRegistrationWorker(context.identity.userId));
    }
  } catch (error) {
    await patchOrchestration(supabase, text(inserted.data.id), {
      state: "exception",
      error_message: error instanceof Error ? error.message : "Shopling 업로드 큐 연결 실패",
      completed_at: new Date().toISOString(),
    }).catch(() => null);
    throw error;
  }

  return Response.json({
    ok: true,
    orchestrationId: text(inserted.data.id),
    state: text(inserted.data.state),
    handoffToken: token,
    requestedCount: runIds.length,
    acceptedCount: acceptedIds.length,
    uploadQueuedCount: uploadQueueIds.length,
    skippedCount: Math.max(0, runIds.length - acceptedIds.length),
    message: "Shopling 업로드 → 마켓전송 원클릭 작업을 만들었습니다. v0.3.30 브라우저 에이전트에 인계하면 이후 자동으로 이어집니다.",
  });
}
