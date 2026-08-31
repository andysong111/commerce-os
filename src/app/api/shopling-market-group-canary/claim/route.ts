import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = "group-canary-v0.2.1";
const SELECT_COLUMNS = "owner_id,goods_key,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,search_prefix,registry_registered_at";
const ORDER: Record<string, number> = {
  wholesale1: 1,
  wholesale2: 2,
  wholesale3: 3,
  wholesale4: 4,
  retail1: 5,
  retail2: 6,
};

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
  return /^canary-group-v021-[A-Za-z0-9._:-]{12,140}$/.test(runId);
}

function profileSearchCode(productGroupKey: string) {
  const values: Record<string, { searchCode: string; profile: string }> = {
    wholesale1: { searchCode: "DM1", profile: "도매1" },
    wholesale2: { searchCode: "DM2", profile: "도매2" },
    wholesale3: { searchCode: "DM3", profile: "도매3" },
    wholesale4: { searchCode: "DM4", profile: "도매4" },
    retail1: { searchCode: "SM1", profile: "소매1" },
    retail2: { searchCode: "SM2", profile: "소매2" },
  };
  return values[productGroupKey] || null;
}

function taskFromRow(raw: unknown) {
  const row = record(raw);
  const productGroupKey = text(row.product_group_key);
  const mapping = profileSearchCode(productGroupKey);
  const goodsKey = text(row.goods_key);
  const ptnGoodsCd = text(row.ptn_goods_cd);
  const launchItemId = text(row.launch_item_id);
  if (!mapping || !/^\d{5,9}$/.test(goodsKey) || !ptnGoodsCd || !launchItemId) return null;
  if (!ptnGoodsCd.toUpperCase().startsWith(`${mapping.searchCode}_`)) return null;
  return {
    goodsKey,
    launchItemId,
    modelNumber: text(row.model_number),
    productGroupKey,
    searchCode: mapping.searchCode,
    profile: mapping.profile,
    ptnGoodsCd,
    registeredAt: text(row.registry_registered_at),
  };
}

function sortTasks<T extends { productGroupKey: string; goodsKey: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const groupDelta = (ORDER[a.productGroupKey] ?? 99) - (ORDER[b.productGroupKey] ?? 99);
    return groupDelta || a.goodsKey.localeCompare(b.goodsKey);
  });
}

function identityKey(ownerId: string, launchItemId: string) {
  return `${ownerId}::${launchItemId}`;
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE) return json({ ok: false, error: "unsupported_group_canary_bridge" }, 400);
  const runId = text(payload.runId);
  if (!validRunId(runId)) return json({ ok: false, error: "invalid_group_canary_run_id" }, 400);

  const supabase = await createSupabaseAdminClient();
  if (!supabase) return json({ ok: false, error: "supabase_admin_unavailable" }, 503);

  const recovered = await supabase
    .from("shopling_market_pipeline_ledger")
    .select(SELECT_COLUMNS)
    .eq("claim_run_id", runId)
    .eq("status", "claimed")
    .eq("market_status", "pending")
    .order("registry_registered_at", { ascending: true })
    .limit(6);
  if (recovered.error) return json({ ok: false, error: "group_canary_recovery_failed", message: recovered.error.message }, 503);
  if (Array.isArray(recovered.data) && recovered.data.length > 0) {
    const tasks = recovered.data.map(taskFromRow).filter(Boolean) as NonNullable<ReturnType<typeof taskFromRow>>[];
    const identities = new Set(tasks.map((task) => task.launchItemId));
    if (tasks.length !== recovered.data.length || identities.size !== 1 || tasks.length > 6) {
      return json({ ok: false, error: "group_canary_recovery_payload_invalid" }, 503);
    }
    return json({ ok: true, bridge: BRIDGE, runId, tasks: sortTasks(tasks), recovered: true });
  }

  const candidates = await supabase
    .from("shopling_market_pipeline_ledger")
    .select(SELECT_COLUMNS)
    .eq("status", "queued")
    .eq("market_status", "pending")
    .order("registry_registered_at", { ascending: true })
    .order("launch_item_id", { ascending: true })
    .limit(120);
  if (candidates.error) return json({ ok: false, error: "group_canary_candidate_failed", message: candidates.error.message }, 503);
  const rows = Array.isArray(candidates.data) ? candidates.data : [];
  if (!rows.length) return json({ ok: true, bridge: BRIDGE, runId, tasks: [], empty: true });

  const queuedIdentities = new Set(
    rows.map((raw) => {
      const row = record(raw);
      return identityKey(text(row.owner_id), text(row.launch_item_id));
    }).filter((value) => !value.startsWith("::") && !value.endsWith("::")),
  );

  const recentSent = await supabase
    .from("shopling_market_pipeline_ledger")
    .select("owner_id,launch_item_id,completed_at,updated_at")
    .eq("status", "sent")
    .eq("market_status", "sent")
    .order("completed_at", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(50);
  if (recentSent.error) {
    return json({ ok: false, error: "group_canary_recent_sent_lookup_failed", message: recentSent.error.message }, 503);
  }

  const recentPartial = (Array.isArray(recentSent.data) ? recentSent.data : [])
    .map(record)
    .find((row) => queuedIdentities.has(identityKey(text(row.owner_id), text(row.launch_item_id))));

  const first = recentPartial
    ? rows.find((raw) => {
        const row = record(raw);
        return text(row.owner_id) === text(recentPartial.owner_id)
          && text(row.launch_item_id) === text(recentPartial.launch_item_id);
      }) || rows[0]
    : rows[0];

  const firstRecord = record(first);
  const ownerId = text(firstRecord.owner_id);
  const launchItemId = text(firstRecord.launch_item_id);
  if (!ownerId || !launchItemId) return json({ ok: false, error: "group_canary_candidate_identity_missing" }, 503);

  const claimedAt = new Date().toISOString();
  const claimed = await supabase
    .from("shopling_market_pipeline_ledger")
    .update({
      status: "claimed",
      claim_run_id: runId,
      claimed_at: claimedAt,
      updated_at: claimedAt,
    })
    .eq("owner_id", ownerId)
    .eq("launch_item_id", launchItemId)
    .eq("status", "queued")
    .eq("market_status", "pending")
    .select(SELECT_COLUMNS);
  if (claimed.error) return json({ ok: false, error: "group_canary_claim_failed", message: claimed.error.message }, 503);

  const claimedRows = Array.isArray(claimed.data) ? claimed.data : [];
  if (!claimedRows.length) {
    return json({ ok: false, error: "group_canary_claim_race", message: "대상 상품의 대기열이 동시에 변경되어 아무 것도 전송하지 않았습니다." }, 409);
  }
  const tasks = claimedRows.map(taskFromRow).filter(Boolean) as NonNullable<ReturnType<typeof taskFromRow>>[];
  const identities = new Set(tasks.map((task) => task.launchItemId));
  if (tasks.length !== claimedRows.length || tasks.length > 6 || identities.size !== 1) {
    return json({
      ok: false,
      error: "group_canary_claim_payload_invalid",
      message: "1개 상품 범위를 벗어난 claim 결과라 자동 송신하지 않습니다.",
      claimedRowCount: claimedRows.length,
      validTaskCount: tasks.length,
    }, 503);
  }

  return json({
    ok: true,
    bridge: BRIDGE,
    runId,
    tasks: sortTasks(tasks),
    taskCount: tasks.length,
    launchItemId,
    resumedPartialProduct: Boolean(recentPartial),
    recovered: false,
  });
}
