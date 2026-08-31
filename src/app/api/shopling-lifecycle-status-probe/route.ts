import {
  loadShoplingLifecycleStatusSnapshot,
  normalizeLifecycleGoodsKeys,
} from "@/lib/shopling/shoplingLifecycleStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GOODS_KEYS = 50;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function invalidGoodsKeys() {
  return Response.json(
    { ok: false, error: "invalid_goods_keys", maxGoodsKeys: MAX_GOODS_KEYS },
    { status: 400, headers: { "cache-control": "no-store" } },
  );
}

async function runProbe(goodsKeys: string[]) {
  if (!goodsKeys.length || goodsKeys.length > MAX_GOODS_KEYS) return invalidGoodsKeys();
  try {
    const snapshot = await loadShoplingLifecycleStatusSnapshot(goodsKeys);
    return Response.json(
      { ok: true, ...snapshot },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "shopling_status_probe_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const payload = object(await request.json().catch(() => null));
  return runProbe(normalizeLifecycleGoodsKeys(payload.goodsKeys, MAX_GOODS_KEYS + 1));
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json(
      { ok: false, error: "preview_probe_only" },
      { status: 405, headers: { "cache-control": "no-store" } },
    );
  }
  const url = new URL(request.url);
  const goodsKeys = normalizeLifecycleGoodsKeys(
    (url.searchParams.get("goodsKeys") ?? "").split(","),
    MAX_GOODS_KEYS + 1,
  );
  return runProbe(goodsKeys);
}
