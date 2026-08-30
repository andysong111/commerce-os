import { buildShoplingTitleKeywordPool } from "@/lib/shoplingTitleKeywordPool";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE_VERSION = "v0.3.1";

type RegistryRow = {
  launch_item_id?: unknown;
  model_number?: unknown;
};

type SeoRunRow = {
  run_id?: unknown;
  checkpoint_payload?: unknown;
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function latestSeoRun(
  supabase: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  column: "launch_item_id" | "model_number",
  value: string,
): Promise<SeoRunRow | null> {
  if (!supabase || !value) return null;
  const result = await supabase
    .from("seo_run_jobs")
    .select("run_id,checkpoint_payload,updated_at")
    .eq(column, value)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (result.error) throw new Error(result.error.message);
  const rows = Array.isArray(result.data) ? result.data : [];
  return (rows[0] as SeoRunRow | undefined) ?? null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const goodsKey = (url.searchParams.get("goodsKey") || "").trim();
  const bridge = (url.searchParams.get("bridge") || "").trim();

  if (bridge !== BRIDGE_VERSION) {
    return json({ ok: false, error: "unsupported_bridge_version" }, 400);
  }
  if (!/^\d{5,9}$/.test(goodsKey)) {
    return json({ ok: false, error: "invalid_goods_key" }, 400);
  }

  const supabase = await createSupabaseAdminClient();
  if (!supabase) {
    return json({ ok: false, error: "supabase_admin_unavailable" }, 503);
  }

  const registryResult = await supabase
    .from("shopling_product_group_registry")
    .select("launch_item_id,model_number")
    .eq("goods_key", goodsKey)
    .maybeSingle();

  if (registryResult.error) {
    return json({ ok: false, error: "registry_lookup_failed" }, 503);
  }

  const registry = registryResult.data as RegistryRow | null;
  if (!registry) {
    return json({ ok: false, error: "goods_key_not_registered" }, 404);
  }

  const launchItemId =
    typeof registry.launch_item_id === "string" ? registry.launch_item_id.trim() : "";
  const modelNumber =
    typeof registry.model_number === "string" ? registry.model_number.trim() : "";

  let run: SeoRunRow | null = null;
  try {
    if (launchItemId) run = await latestSeoRun(supabase, "launch_item_id", launchItemId);
    if (!run && modelNumber) run = await latestSeoRun(supabase, "model_number", modelNumber);
  } catch {
    return json({ ok: false, error: "seo_run_lookup_failed" }, 503);
  }

  if (!run) {
    return json({ ok: true, goodsKey, keywords: [], candidateCount: 0, source: "none" });
  }

  const keywords = buildShoplingTitleKeywordPool(run.checkpoint_payload);
  return json({
    ok: true,
    goodsKey,
    keywords,
    candidateCount: keywords.length,
    source: keywords.length ? "seo_run" : "none",
  });
}
