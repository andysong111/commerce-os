import { NextRequest } from "next/server";
import { fetchShoplingCategoryRefreshStatus } from "@/lib/shoplingCategoryCatalog";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }
  try {
    const result = await fetchShoplingCategoryRefreshStatus();
    return Response.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      message: error instanceof Error ? error.message : "카테고리 상태 확인 실패",
    }, { status: 503 });
  }
}
