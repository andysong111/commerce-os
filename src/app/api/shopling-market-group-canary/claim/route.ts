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
  return /^canary-group-v0(?:21|30)-[A-Za-z0-9._:-]{12,140}$/.test(runId);
}

function visibleGoodsKeys(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.map(text).filter((key) => /^\d{5,9}$/.test(key)))].slice(0, 25);
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

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE) return json({ ok: false, error: "unsupported_group_canary_bridge" }, 400);
  const runId = text(payload.runId);
  if (!validRunId(runId)) return json({ ok: false, error: "invalid_group_canary_run_id" }, 400);

  const requestedVisibleGoodsKeys = visibleGoodsKeys(payload.visibleGoodsKeys);
  if (!requestedVisibleGoodsKeys.length) {
    return json({
      ok: false,
      error: "group_canary_visible_goods_keys_required",
      message: "현재 A18 화면의 상품번호를 식별하지 못해 과거 대기상품을 임의 처리하지 않습니다.",
    }, 409);
  }

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
    return json({ ok: true, bridge: BRIDGE, runId, tasks: sortTasks(tasks), recovered: true, anchoredToVisibleA18: true });
  }

  const visibleCandidates = await supabase
    .from("shopling_market_pipeline_ledger")
    .select(SELECT_COLUMNS)
    .in("goods_key", requestedVisibleGoodsKeys)
    .eq("status", "queued")
    .eq("market_status", "pending")
    .limit(25);
  if (visibleCandidates.error) {
    return json({ ok: false, error: "group_canary_visible_candidate_failed", message: visibleCandidates.error.message }, 503);
  }

  const visibleRows = Array.isArray(visibleCandidates.data) ? visibleCandidates.data.map(record) : [];
  if (!visibleRows.length) {
    return json({
      ok: true,
      bridge: BRIDGE,
      runId,
      tasks: [],
      empty: true,
      anchoredToVisibleA18: true,
      message: "현재 A18 화면에서 Commerce OS 대기열과 일치하는 미전송 상품이 없습니다.",
    });
  }

  const firstVisible = requestedVisibleGoodsKeys
    .map((goodsKey) => visibleRows.find((row) => text(row.goods_key) === goodsKey))
    .find(Boolean);
  if (!firstVisible) {
    return json({ ok: false, error: "group_canary_visible_identity_missing" }, 409);
  }

  const ownerId = text(firstVisible.owner_id);
  const launchItemId = text(firstVisible.launch_item_id);
  if (!ownerId || !launchItemId) {
    return json({ ok: false, error: "group_canary_visible_identity_invalid" }, 503);
  }

  const identityRows = visibleRows.filter(
    (row) => text(row.owner_id) === ownerId && text(row.launch_item_id) === launchItemId,
  );
  if (!identityRows.length) return json({ ok: false, error: "group_canary_visible_identity_empty" }, 409);

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
    return json({ ok: false, error: "group_canary_claim_race", message: "현재 A18 대상의 대기열이 동시에 변경되어 아무 것도 전송하지 않았습니다." }, 409);
  }
  const tasks = claimedRows.map(taskFromRow).filter(Boolean) as NonNullable<ReturnType<typeof taskFromRow>>[];
  const identities = new Set(tasks.map((task) => task.launchItemId));
  if (tasks.length !== claimedRows.length || tasks.length > 6 || identities.size !== 1) {
    return json({
      ok: false,
      error: "group_canary_claim_payload_invalid",
      message: "현재 A18에서 식별한 1개 상품 범위를 벗어난 claim 결과라 자동 송신하지 않습니다.",
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
    visibleMatchCount: identityRows.length,
    visibleGoodsKeys: requestedVisibleGoodsKeys,
    anchoredToVisibleA18: true,
    recovered: false,
  });
}
