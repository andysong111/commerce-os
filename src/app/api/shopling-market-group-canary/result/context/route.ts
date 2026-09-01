import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE = "shopling-market-result-context-v0.1";
const LEDGER_TABLE = "shopling_market_pipeline_ledger";
const MAX_KEYS = 20;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

const CHANNELS: Record<string, { searchCode: string; profile: string }> = {
  wholesale1: { searchCode: "DM1", profile: "도매1" },
  wholesale2: { searchCode: "DM2", profile: "도매2" },
  wholesale3: { searchCode: "DM3", profile: "도매3" },
  wholesale4: { searchCode: "DM4", profile: "도매4" },
  retail1: { searchCode: "SM1", profile: "소매1" },
  retail2: { searchCode: "SM2", profile: "소매2" },
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function candidateGoodsKeys(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.map(text).filter((key) => /^\d{5,9}$/.test(key)))].slice(0, MAX_KEYS);
}

function taskFromLedger(raw: unknown) {
  const row = record(raw);
  const productGroupKey = text(row.product_group_key);
  const mapping = CHANNELS[productGroupKey];
  const goodsKey = text(row.goods_key);
  const ptnGoodsCd = text(row.ptn_goods_cd);
  const runId = text(row.claim_run_id);
  if (!mapping || !/^\d{5,9}$/.test(goodsKey) || !ptnGoodsCd || !runId) return null;
  if (!ptnGoodsCd.toUpperCase().startsWith(`${mapping.searchCode}_`)) return null;
  const armedAt = text(row.submit_armed_at);
  const armedMs = armedAt ? Date.parse(armedAt) : Number.NaN;
  if (!Number.isFinite(armedMs) || Date.now() - armedMs > MAX_AGE_MS) return null;
  return {
    runId,
    goodsKey,
    task: {
      goodsKey,
      launchItemId: text(row.launch_item_id),
      modelNumber: text(row.model_number),
      productGroupKey,
      searchCode: mapping.searchCode,
      profile: mapping.profile,
      ptnGoodsCd,
      registeredAt: text(row.registry_registered_at),
    },
    submitArmedAt: armedAt,
  };
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE) {
    return Response.json({ ok: false, error: "unsupported_shopling_result_context_bridge" }, { status: 400 });
  }

  const keys = candidateGoodsKeys(payload.candidateGoodsKeys);
  if (!keys.length) {
    return Response.json({ ok: true, bridge: BRIDGE, contexts: [], count: 0 });
  }

  const supabase = await createSupabaseAdminClient();
  if (!supabase) {
    return Response.json({ ok: false, error: "supabase_admin_unavailable" }, { status: 503 });
  }

  const result = await supabase
    .from(LEDGER_TABLE)
    .select("goods_key,claim_run_id,launch_item_id,model_number,product_group_key,profile,ptn_goods_cd,registry_registered_at,status,market_status,submit_armed_at,updated_at")
    .in("goods_key", keys)
    .eq("status", "claimed")
    .eq("market_status", "submit_armed")
    .not("submit_armed_at", "is", null)
    .limit(MAX_KEYS);

  if (result.error) {
    return Response.json(
      { ok: false, error: "shopling_result_context_lookup_failed", message: result.error.message },
      { status: 503 },
    );
  }

  const contexts = (Array.isArray(result.data) ? result.data : [])
    .map(taskFromLedger)
    .filter(Boolean);

  return Response.json(
    {
      ok: true,
      bridge: BRIDGE,
      contexts,
      count: contexts.length,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
