import { NextRequest } from "next/server";
import {
  dispatchShoplingCategoryRefresh,
  generateShoplingCategoryRequestId,
} from "@/lib/shoplingCategoryCatalog";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }
  const requestId = generateShoplingCategoryRequestId();
  try {
    const result = await dispatchShoplingCategoryRefresh(requestId);
    return Response.json(
      {
        ok: result.ok,
        status: result.ok ? "dispatch_requested" : "blocked",
        requestId,
        message: result.ok
          ? "샵플링 카테고리 최신화 작업을 요청했습니다."
          : result.message,
        actionsUrl: result.actionsUrl,
      },
      { status: result.ok ? 200 : 502 },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        status: "blocked",
        requestId,
        message:
          error instanceof Error
            ? error.message
            : "카테고리 최신화 작업을 시작하지 못했습니다.",
      },
      { status: 503 },
    );
  }
}
