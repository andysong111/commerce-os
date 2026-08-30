import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRIDGE_VERSION = "v0.5.2";
const MAX_GOODS_KEYS = 2000;

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

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  if (text(payload.bridge) !== BRIDGE_VERSION) {
    return json({ ok: false, error: "unsupported_bridge_version" }, 400);
  }

  const supabase = await createSupabaseAdminClient();
  if (!supabase) return json({ ok: false, error: "supabase_admin_unavailable" }, 503);

  const result = await supabase
    .from("shopling_product_group_registry")
    .select("goods_key,registered_at")
    .eq("shopling_status", "success")
    .order("registered_at", { ascending: false })
    .limit(MAX_GOODS_KEYS);

  if (result.error) {
    return json({ ok: false, error: "registry_read_failed", message: result.error.message }, 503);
  }

  const seen = new Set<string>();
  const rows = Array.isArray(result.data) ? result.data : [];
  for (const raw of rows) {
    const row = record(raw);
    const goodsKey = text(row.goods_key);
    if (/^\d{5,9}$/.test(goodsKey)) seen.add(goodsKey);
  }

  return json({
    ok: true,
    bridge: BRIDGE_VERSION,
    goodsKeys: [...seen],
    count: seen.size,
    maxGoodsKeys: MAX_GOODS_KEYS,
    source: "shopling_product_group_registry",
  });
}
