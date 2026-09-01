import {
  claimInternalChinaBrowserMallPriceReadback,
  INTERNAL_CHINA_BROWSER_PRICE_READBACK_BRIDGE,
  reportInternalChinaBrowserMallPriceReadback,
} from "@/lib/internalChinaBrowserMallPriceReadback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

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

export async function POST(request: Request) {
  const payload = object(await request.json().catch(() => null));
  if (text(payload.bridge) !== INTERNAL_CHINA_BROWSER_PRICE_READBACK_BRIDGE) {
    return json({ ok: false, error: "unsupported_bridge_version" }, 400);
  }
  const action = text(payload.action);
  try {
    if (action === "claim") {
      const result = await claimInternalChinaBrowserMallPriceReadback(payload.runId);
      return json({
        ok: true,
        bridge: INTERNAL_CHINA_BROWSER_PRICE_READBACK_BRIDGE,
        ...result,
      });
    }
    if (action === "report") {
      const result = await reportInternalChinaBrowserMallPriceReadback({
        ...payload,
        bridgeVersion: INTERNAL_CHINA_BROWSER_PRICE_READBACK_BRIDGE,
      });
      return json({
        ok: true,
        bridge: INTERNAL_CHINA_BROWSER_PRICE_READBACK_BRIDGE,
        ...result,
      });
    }
    return json({ ok: false, error: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "price readback bridge failed");
    return json({ ok: false, error: message.split(":", 1)[0], message }, 400);
  }
}
