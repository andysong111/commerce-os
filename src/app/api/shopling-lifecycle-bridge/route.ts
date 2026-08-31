import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE_VERSION = "lifecycle-v1";
const MAX_CLAIM = 20;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function validRunId(value: string) {
  return /^[A-Za-z0-9._:-]{12,160}$/.test(value);
}

function dueNow(value: unknown, nowMs: number) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) && parsed <= nowMs;
}

export async function POST(request: Request) {
  const payload = object(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE_VERSION) {
    return json({ ok: false, error: "unsupported_bridge_version" }, 400);
  }
  const action = text(payload.action);
  const admin = await createSupabaseAdminClient();
  if (!admin) return json({ ok: false, error: "supabase_admin_unavailable" }, 503);

  if (action === "claim") {
    const runId = text(payload.runId);
    if (!validRunId(runId)) return json({ ok: false, error: "invalid_run_id" }, 400);
    const rawLimit = Number(payload.limit ?? 5);
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5, MAX_CLAIM));

    const recovered = await admin
      .from("shopling_lifecycle_action_queue")
      .select("id,sku_id,barcode,goods_key,desired_state,lifecycle_state,reason_codes,scheduled_for")
      .eq("claim_run_id", runId)
      .eq("status", "claimed")
      .eq("shadow_mode", false)
      .order("scheduled_for", { ascending: true })
      .limit(limit);
    if (recovered.error) {
      return json({ ok: false, error: "claim_recovery_failed", message: recovered.error.message }, 503);
    }
    if (Array.isArray(recovered.data) && recovered.data.length) {
      return json({ ok: true, bridge: BRIDGE_VERSION, runId, tasks: recovered.data, recovered: true });
    }

    const candidates = await admin
      .from("shopling_lifecycle_action_queue")
      .select("id,sku_id,barcode,goods_key,desired_state,lifecycle_state,reason_codes,scheduled_for")
      .eq("status", "pending")
      .eq("shadow_mode", false)
      .order("scheduled_for", { ascending: true })
      .limit(limit * 4);
    if (candidates.error) {
      return json({ ok: false, error: "claim_candidates_failed", message: candidates.error.message }, 503);
    }

    const tasks: unknown[] = [];
    const claimedAt = new Date().toISOString();
    const claimable = (Array.isArray(candidates.data) ? candidates.data : []).filter((candidate) =>
      dueNow(candidate.scheduled_for, Date.parse(claimedAt)),
    );
    for (const candidate of claimable) {
      if (tasks.length >= limit) break;
      const id = text(candidate.id);
      if (!id) continue;
      const claimed = await admin
        .from("shopling_lifecycle_action_queue")
        .update({
          status: "claimed",
          claim_run_id: runId,
          claimed_at: claimedAt,
          updated_at: claimedAt,
        })
        .eq("id", id)
        .eq("status", "pending")
        .eq("shadow_mode", false)
        .select("id,sku_id,barcode,goods_key,desired_state,lifecycle_state,reason_codes,scheduled_for")
        .maybeSingle();
      if (claimed.error) {
        return json({ ok: false, error: "claim_update_failed", message: claimed.error.message }, 503);
      }
      if (claimed.data) tasks.push(claimed.data);
    }

    return json({ ok: true, bridge: BRIDGE_VERSION, runId, tasks, recovered: false });
  }

  if (action === "report") {
    const runId = text(payload.runId);
    const taskId = text(payload.taskId);
    const outcome = text(payload.outcome);
    if (!validRunId(runId) || !taskId) {
      return json({ ok: false, error: "invalid_report_identity" }, 400);
    }
    if (!["succeeded", "failed", "confirm_needed"].includes(outcome)) {
      return json({ ok: false, error: "invalid_outcome" }, 400);
    }
    const now = new Date().toISOString();
    const result = await admin
      .from("shopling_lifecycle_action_queue")
      .update({
        status: outcome,
        executed_at: outcome === "succeeded" ? now : null,
        last_error: outcome === "succeeded" ? null : text(payload.message).slice(0, 1000),
        updated_at: now,
      })
      .eq("id", taskId)
      .eq("claim_run_id", runId)
      .eq("status", "claimed")
      .eq("shadow_mode", false)
      .select("id,status,goods_key,desired_state")
      .maybeSingle();
    if (result.error) {
      return json({ ok: false, error: "report_update_failed", message: result.error.message }, 503);
    }
    if (!result.data) {
      return json({ ok: false, error: "report_rejected" }, 409);
    }
    return json({ ok: true, bridge: BRIDGE_VERSION, recorded: true, task: result.data });
  }

  return json({ ok: false, error: "unsupported_action" }, 400);
}
