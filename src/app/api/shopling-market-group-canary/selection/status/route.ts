import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = "shopling-market-selection-status-v0.1";
const JOB_TABLE = "product_launch_upload_jobs";
const LEDGER_TABLE = "shopling_market_pipeline_ledger";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requestedGoodsKeys(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.map(text).filter((key) => /^\d{5,9}$/.test(key)))].slice(0, 6);
}

function jobGoodsKeys(job: Record<string, unknown>) {
  const rows = Array.isArray(record(job.result).rows) ? (record(job.result).rows as unknown[]) : [];
  return [...new Set(
    rows
      .map(record)
      .filter((row) => text(row.status) === "success")
      .map((row) => text(row.goods_key || row.goodsKey))
      .filter((key) => /^\d{5,9}$/.test(key)),
  )].slice(0, 6);
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE) {
    return Response.json({ ok: false, error: "unsupported_shopling_market_selection_status_bridge" }, { status: 400 });
  }

  const jobId = text(payload.jobId);
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return Response.json({ ok: false, error: "invalid_shopling_upload_job_id" }, { status: 400 });
  }

  const supabase = await createSupabaseAdminClient();
  if (!supabase) return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });

  const jobResult = await supabase
    .from(JOB_TABLE)
    .select("id,owner_id,result")
    .eq("id", jobId)
    .limit(1)
    .maybeSingle();
  if (jobResult.error) {
    return Response.json({ ok: false, error: "shopling_selected_status_job_read_failed", message: jobResult.error.message }, { status: 503 });
  }
  if (!jobResult.data) return Response.json({ ok: false, error: "shopling_selected_job_not_found" }, { status: 404 });

  const job = record(jobResult.data);
  const ownerId = text(job.owner_id);
  const validBatchKeys = jobGoodsKeys(job);
  if (!ownerId || validBatchKeys.length !== 6) {
    return Response.json({ ok: false, error: "shopling_selected_status_batch_invalid" }, { status: 409 });
  }

  const requested = requestedGoodsKeys(payload.goodsKeys);
  const validSet = new Set(validBatchKeys);
  const keys = (requested.length ? requested : validBatchKeys).filter((key) => validSet.has(key));
  if (!keys.length) return Response.json({ ok: false, error: "shopling_selected_status_goods_keys_invalid" }, { status: 400 });

  const ledger = await supabase
    .from(LEDGER_TABLE)
    .select("goods_key,status,market_status,claim_run_id,claimed_at,submit_armed_at,completed_at,reason_code,message,updated_at")
    .eq("owner_id", ownerId)
    .in("goods_key", keys)
    .limit(6);
  if (ledger.error) {
    return Response.json({ ok: false, error: "shopling_selected_status_ledger_read_failed", message: ledger.error.message }, { status: 503 });
  }

  const rows = (Array.isArray(ledger.data) ? ledger.data : []).map((raw) => {
    const row = record(raw);
    return {
      goodsKey: text(row.goods_key),
      status: text(row.status),
      marketStatus: text(row.market_status),
      claimRunId: text(row.claim_run_id),
      claimedAt: text(row.claimed_at),
      submitArmedAt: text(row.submit_armed_at),
      completedAt: text(row.completed_at),
      reasonCode: text(row.reason_code),
      message: text(row.message),
      updatedAt: text(row.updated_at),
    };
  });

  const terminal = new Set(["sent", "already_registered", "confirm_needed", "legacy_ignored"]);
  const summary = {
    requestedCount: keys.length,
    rowCount: rows.length,
    sentCount: rows.filter((row) => row.marketStatus === "sent" || row.status === "sent").length,
    alreadyRegisteredCount: rows.filter((row) => row.marketStatus === "already_registered" || row.status === "already_registered").length,
    confirmNeededCount: rows.filter((row) => row.marketStatus === "confirm_needed" || row.status === "confirm_needed").length,
    pendingCount: rows.filter((row) => row.marketStatus === "pending" && row.status === "queued").length,
    busyCount: rows.filter((row) => row.status === "claimed" || row.marketStatus === "submit_armed").length,
    terminalCount: rows.filter((row) => terminal.has(row.marketStatus) || terminal.has(row.status)).length,
  };

  return Response.json({ ok: true, bridge: BRIDGE, jobId, rows, summary });
}
