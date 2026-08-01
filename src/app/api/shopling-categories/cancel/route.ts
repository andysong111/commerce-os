import { NextRequest } from "next/server";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";
import { cancelShoplingCategoryUpdate } from "@/lib/shoplingCategoryCancel";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }

  let body: { requestId?: unknown; startedAt?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  try {
    const result = await cancelShoplingCategoryUpdate({
      requestId: String(body.requestId ?? "").trim(),
      startedAt: String(body.startedAt ?? "").trim(),
    });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "샵플링 카테고리 업데이트를 취소하지 못했습니다.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
