import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = "group-canary-release-v0.3.2";

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

function validRunId(runId: string) {
  return /^canary-group-v0(?:21|30)-[A-Za-z0-9._:-]{12,150}$/.test(runId);
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE) {
    return json({ ok: false, error: "unsupported_group_canary_release_bridge" }, 400);
  }

  const runId = text(payload.runId);
  if (!validRunId(runId)) {
    return json({ ok: false, error: "invalid_group_canary_run_id" }, 400);
  }

  const reasonCode = text(payload.reasonCode) || "fresh_worker_pre_submit_release";
  const message = text(payload.message) || "Fresh Worker가 송신 전에 중단되어 claim을 원복했습니다.";
  const supabase = await createSupabaseAdminClient();
  if (!supabase) return json({ ok: false, error: "supabase_admin_unavailable" }, 503);

  const now = new Date().toISOString();
  const released = await supabase
    .from("shopling_market_pipeline_ledger")
    .update({
      status: "queued",
      market_status: "pending",
      claim_run_id: "",
      claimed_at: null,
      reason_code: reasonCode,
      message,
      updated_at: now,
    })
    .eq("claim_run_id", runId)
    .eq("status", "claimed")
    .eq("market_status", "pending")
    .is("submit_armed_at", null)
    .select("goods_key,profile");

  if (released.error) {
    return json({ ok: false, error: "group_canary_release_failed", message: released.error.message }, 503);
  }

  return json({
    ok: true,
    bridge: BRIDGE,
    runId,
    releasedCount: Array.isArray(released.data) ? released.data.length : 0,
    released: Array.isArray(released.data) ? released.data : [],
  });
}
