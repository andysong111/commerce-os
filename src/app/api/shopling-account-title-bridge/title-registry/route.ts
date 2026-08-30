import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE_VERSION = "v0.5.3";
const MAX_TASKS = 500;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function validRunId(value: string) {
  return /^[A-Za-z0-9._:-]{12,160}$/.test(value);
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE_VERSION) {
    return json({ ok: false, error: "unsupported_bridge_version" }, 400);
  }

  const action = text(payload.action) || "claim";
  const supabase = await createSupabaseAdminClient();
  if (!supabase) return json({ ok: false, error: "supabase_admin_unavailable" }, 503);

  if (action === "claim") {
    const runId = text(payload.runId);
    if (!validRunId(runId)) return json({ ok: false, error: "invalid_run_id" }, 400);
    const requested = Number(payload.limit || MAX_TASKS);
    const limit = Math.max(1, Math.min(Number.isFinite(requested) ? Math.floor(requested) : MAX_TASKS, MAX_TASKS));
    const result = await supabase.rpc("claim_shopling_title_diversification_tasks", {
      p_run_id: runId,
      p_limit: limit,
    });
    if (result.error) {
      return json({ ok: false, error: "title_claim_failed", message: result.error.message }, 503);
    }
    const tasks = (Array.isArray(result.data) ? result.data : [])
      .map(record)
      .map((row) => ({
        goodsKey: text(row.goods_key),
        registeredAt: text(row.registry_registered_at),
      }))
      .filter((row) => /^\d{5,9}$/.test(row.goodsKey));
    return json({
      ok: true,
      bridge: BRIDGE_VERSION,
      runId,
      tasks,
      goodsKeys: tasks.map((task) => task.goodsKey),
      count: tasks.length,
      source: "shopling_title_diversification_ledger",
    });
  }

  if (action === "report") {
    const runId = text(payload.runId);
    const goodsKey = text(payload.goodsKey);
    const outcome = text(payload.outcome);
    if (!validRunId(runId) || !/^\d{5,9}$/.test(goodsKey)) {
      return json({ ok: false, error: "invalid_title_report" }, 400);
    }
    if (!["changed", "skipped", "failed"].includes(outcome)) {
      return json({ ok: false, error: "invalid_title_outcome" }, 400);
    }
    const result = await supabase.rpc("report_shopling_title_diversification_task", {
      p_run_id: runId,
      p_goods_key: goodsKey,
      p_outcome: outcome,
      p_reason_code: text(payload.reasonCode).slice(0, 120),
      p_message: text(payload.message).slice(0, 1000),
    });
    if (result.error) return json({ ok: false, error: "title_report_failed", message: result.error.message }, 503);
    if (result.data !== true) return json({ ok: false, error: "title_report_rejected" }, 409);
    return json({ ok: true, recorded: true, goodsKey, outcome });
  }

  if (action === "retry-failures") {
    const requested = Number(payload.limit || MAX_TASKS);
    const limit = Math.max(1, Math.min(Number.isFinite(requested) ? Math.floor(requested) : MAX_TASKS, MAX_TASKS));
    const result = await supabase.rpc("retry_shopling_title_diversification_failures", { p_limit: limit });
    if (result.error) return json({ ok: false, error: "title_retry_failed", message: result.error.message }, 503);
    return json({ ok: true, requeued: Number(result.data || 0) });
  }

  if (action === "stats") {
    const result = await supabase
      .from("shopling_title_diversification_ledger")
      .select("status")
      .limit(5000);
    if (result.error) return json({ ok: false, error: "title_stats_failed", message: result.error.message }, 503);
    const counts: Record<string, number> = {};
    for (const raw of Array.isArray(result.data) ? result.data : []) {
      const status = text(record(raw).status);
      if (status) counts[status] = (counts[status] || 0) + 1;
    }
    return json({
      ok: true,
      counts,
      pending: Number(counts.queued || 0),
      running: Number(counts.claimed || 0),
      retryable: Number(counts.failed || 0) + Number(counts.confirm_needed || 0),
      baseline: Number(counts.baseline_processed || 0),
      completed: Number(counts.diversified || 0) + Number(counts.already_normal || 0),
    });
  }

  return json({ ok: false, error: "unsupported_action" }, 400);
}
