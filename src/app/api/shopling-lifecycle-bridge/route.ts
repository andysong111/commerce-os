import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadShoplingLifecycleStatusSnapshot } from "@/lib/shopling/shoplingLifecycleStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE_VERSION = "lifecycle-v1";
const MAX_CLAIM = 20;
const STALE_CLAIM_MINUTES = 15;

type AdminClient = NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>;

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
  return /^[A-Za-z0-9._:-]{12,180}$/.test(value);
}

function dueNow(value: unknown, nowMs: number) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) && parsed <= nowMs;
}

function deleteExecutionEnabled() {
  return process.env.SHOPLING_LIFECYCLE_DELETE_EXECUTION_ENABLED === "true";
}

function claimableDesiredState(value: unknown, allowDelete: boolean) {
  const desired = text(value);
  if (desired === "SELLING" || desired === "SOLD_OUT") return true;
  return desired === "DELETE" && allowDelete;
}

function desiredSaleStatusCode(value: unknown) {
  const desired = text(value);
  if (desired === "SELLING") return "B";
  if (desired === "SOLD_OUT") return "C";
  return "";
}

function noopOnlyCanary(evidence: unknown) {
  return object(evidence).canaryNoopOnly === true;
}

function forceBrowserNoopCanary(evidence: unknown) {
  return object(evidence).forceBrowserNoopCanary === true;
}

function strictNoopCanary(evidence: unknown) {
  return noopOnlyCanary(evidence) || forceBrowserNoopCanary(evidence);
}

function preflightEvidence(
  evidence: unknown,
  input: {
    at: string;
    state: string;
    currentSaleStatus: string;
    noop: boolean;
    error?: string;
  },
) {
  return {
    ...object(evidence),
    preflightAt: input.at,
    preflightSource: "shopling_product_read_api",
    preflightState: input.state,
    preflightCurrentSaleStatus: input.currentSaleStatus,
    preflightNoop: input.noop,
    ...(input.error ? { preflightError: input.error } : {}),
  };
}

async function recoverStaleClaims(admin: AdminClient) {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  const stale = await admin
    .from("shopling_lifecycle_action_queue")
    .select("id")
    .eq("status", "claimed")
    .eq("shadow_mode", false)
    .lt("claimed_at", cutoff)
    .limit(50);
  if (stale.error) return stale.error;
  for (const row of Array.isArray(stale.data) ? stale.data : []) {
    const id = text(row.id);
    if (!id) continue;
    const now = new Date().toISOString();
    const recovered = await admin
      .from("shopling_lifecycle_action_queue")
      .update({
        status: "confirm_needed",
        last_error: `Lifecycle browser claim exceeded ${STALE_CLAIM_MINUTES} minutes without verified completion.`,
        updated_at: now,
      })
      .eq("id", id)
      .eq("status", "claimed")
      .eq("shadow_mode", false);
    if (recovered.error) return recovered.error;
  }
  return null;
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
    const allowDelete = deleteExecutionEnabled();

    const staleError = await recoverStaleClaims(admin);
    if (staleError) {
      return json({ ok: false, error: "stale_claim_recovery_failed", message: staleError.message }, 503);
    }

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
    const recoveredRows = (Array.isArray(recovered.data) ? recovered.data : []).filter((row) =>
      claimableDesiredState(row.desired_state, allowDelete),
    );
    if (recoveredRows.length) {
      return json({
        ok: true,
        bridge: BRIDGE_VERSION,
        runId,
        tasks: recoveredRows,
        recovered: true,
        deleteExecutionEnabled: allowDelete,
      });
    }

    const candidates = await admin
      .from("shopling_lifecycle_action_queue")
      .select("id,sku_id,barcode,goods_key,desired_state,lifecycle_state,reason_codes,scheduled_for,evidence")
      .eq("status", "pending")
      .eq("shadow_mode", false)
      .order("scheduled_for", { ascending: true })
      .limit(limit * 12);
    if (candidates.error) {
      return json({ ok: false, error: "claim_candidates_failed", message: candidates.error.message }, 503);
    }

    const tasks: unknown[] = [];
    const claimedAt = new Date().toISOString();
    const claimable = (Array.isArray(candidates.data) ? candidates.data : []).filter((candidate) =>
      dueNow(candidate.scheduled_for, Date.parse(claimedAt)) &&
      claimableDesiredState(candidate.desired_state, allowDelete),
    );

    const preflightGoodsKeys = [
      ...new Set(
        claimable
          .filter((candidate) => desiredSaleStatusCode(candidate.desired_state))
          .map((candidate) => text(candidate.goods_key))
          .filter(Boolean),
      ),
    ];
    let preflightError = "";
    let preflightStatuses = new Map<string, { state: string; currentSaleStatus: string }>();
    if (preflightGoodsKeys.length) {
      try {
        const snapshot = await loadShoplingLifecycleStatusSnapshot(preflightGoodsKeys);
        preflightStatuses = new Map(
          snapshot.statuses.map((status) => [
            status.goodsKey,
            { state: status.state, currentSaleStatus: status.currentSaleStatus },
          ]),
        );
      } catch (error) {
        preflightError = error instanceof Error ? error.message : String(error);
      }
    }

    let preflightNoopCount = 0;
    let preflightBlockedCanaryCount = 0;
    for (const candidate of claimable) {
      if (tasks.length >= limit) break;
      const id = text(candidate.id);
      if (!id) continue;
      const desiredCode = desiredSaleStatusCode(candidate.desired_state);
      const goodsKey = text(candidate.goods_key);
      const preflight = desiredCode ? preflightStatuses.get(goodsKey) : undefined;
      const evidence = object(candidate.evidence);
      const forceBrowser = forceBrowserNoopCanary(evidence);
      const verifiedSameState = Boolean(
        desiredCode && preflight?.state === "READY" && preflight.currentSaleStatus === desiredCode,
      );

      if (verifiedSameState && !forceBrowser) {
        const completed = await admin
          .from("shopling_lifecycle_action_queue")
          .update({
            status: "succeeded",
            executed_at: claimedAt,
            last_error: null,
            evidence: preflightEvidence(evidence, {
              at: claimedAt,
              state: preflight?.state || "READY",
              currentSaleStatus: preflight?.currentSaleStatus || desiredCode,
              noop: true,
            }),
            updated_at: claimedAt,
          })
          .eq("id", id)
          .eq("status", "pending")
          .eq("shadow_mode", false)
          .select("id")
          .maybeSingle();
        if (completed.error) {
          return json({ ok: false, error: "preflight_noop_update_failed", message: completed.error.message }, 503);
        }
        if (completed.data) preflightNoopCount += 1;
        continue;
      }

      if (desiredCode && strictNoopCanary(evidence) && !verifiedSameState) {
        const current = preflight?.currentSaleStatus || "UNKNOWN";
        const state = preflight?.state || (preflightError ? "ERROR" : "MISSING");
        const message = preflightError
          ? `No-op Canary Shopling 상태조회 실패로 변경을 실행하지 않았습니다: ${preflightError}`
          : `No-op Canary는 목표 ${desiredCode} 상태만 허용합니다. 현재=${current}, 조회상태=${state}; 브라우저 변경을 실행하지 않았습니다.`;
        const blocked = await admin
          .from("shopling_lifecycle_action_queue")
          .update({
            status: "confirm_needed",
            executed_at: null,
            last_error: message.slice(0, 1000),
            evidence: preflightEvidence(evidence, {
              at: claimedAt,
              state,
              currentSaleStatus: current,
              noop: false,
              ...(preflightError ? { error: preflightError } : {}),
            }),
            updated_at: claimedAt,
          })
          .eq("id", id)
          .eq("status", "pending")
          .eq("shadow_mode", false)
          .select("id")
          .maybeSingle();
        if (blocked.error) {
          return json({ ok: false, error: "preflight_canary_block_failed", message: blocked.error.message }, 503);
        }
        if (blocked.data) preflightBlockedCanaryCount += 1;
        continue;
      }

      const evidenceWithPreflight = desiredCode
        ? preflightEvidence(evidence, {
            at: claimedAt,
            state: preflight?.state || (preflightError ? "ERROR" : "MISSING"),
            currentSaleStatus: preflight?.currentSaleStatus || "",
            noop: false,
            ...(preflightError ? { error: preflightError } : {}),
          })
        : evidence;
      const claimed = await admin
        .from("shopling_lifecycle_action_queue")
        .update({
          status: "claimed",
          claim_run_id: runId,
          claimed_at: claimedAt,
          evidence: evidenceWithPreflight,
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

    return json({
      ok: true,
      bridge: BRIDGE_VERSION,
      runId,
      tasks,
      recovered: false,
      deleteExecutionEnabled: allowDelete,
      preflightNoopCount,
      preflightBlockedCanaryCount,
      preflightReadError: preflightError || null,
    });
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
