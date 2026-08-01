import { NextRequest } from "next/server";
import {
  dispatchShoplingCategoryRefresh,
  generateShoplingCategoryRequestId,
} from "@/lib/shoplingCategoryCatalog";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";

const CATEGORY_RUN_COOKIE = "commerce_os_shopling_category_run";

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }
  const requestId = generateShoplingCategoryRequestId();
  const startedAt = new Date().toISOString();
  try {
    const result = await dispatchShoplingCategoryRefresh(requestId);
    const response = Response.json(
      {
        ok: result.ok,
        status: result.ok ? "dispatch_requested" : "blocked",
        requestId,
        startedAt,
        message: result.ok
          ? "샵플링 카테고리 업데이트 작업을 요청했습니다."
          : result.message,
        actionsUrl: result.actionsUrl,
      },
      { status: result.ok ? 200 : 502 },
    );
    if (result.ok) {
      response.headers.append(
        "Set-Cookie",
        `${CATEGORY_RUN_COOKIE}=${encodeURIComponent(
          JSON.stringify({ requestId, startedAt }),
        )}; Path=/; Max-Age=7200; SameSite=Lax; Secure`,
      );
    }
    return response;
  } catch (error) {
    return Response.json(
      {
        ok: false,
        status: "blocked",
        requestId,
        startedAt,
        message:
          error instanceof Error
            ? error.message
            : "카테고리 업데이트 작업을 시작하지 못했습니다.",
      },
      { status: 503 },
    );
  }
}
