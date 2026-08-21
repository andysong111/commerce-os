import { NextResponse } from "next/server";
import { probeConfiguredOpenAiKeys } from "@/lib/openAiKeyHealth";
import { requireShoplingPriceAdjustmentOperator } from "@/lib/shoplingPriceAdjustmentAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authenticated = await requireShoplingPriceAdjustmentOperator(request);
  if (!authenticated.ok) return authenticated.response;

  const lanes = await probeConfiguredOpenAiKeys();
  const allOk = lanes.every((lane) => lane.ok);

  return NextResponse.json(
    {
      ok: allOk,
      checkedAt: new Date().toISOString(),
      lanes,
      legacyFallbackConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      note: allOk
        ? "All dedicated OpenAI keys authenticated successfully."
        : "One or more dedicated OpenAI keys need attention.",
    },
    {
      status: allOk ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
      },
    },
  );
}
