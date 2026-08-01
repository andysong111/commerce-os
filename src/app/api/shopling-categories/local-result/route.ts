import { NextRequest } from "next/server";
import { publishLocalShoplingCategorySnapshot } from "@/lib/shoplingCategoryLocalPublish";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, message: "로컬 카테고리 결과 JSON을 읽을 수 없습니다." },
      { status: 400 },
    );
  }

  try {
    const source =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { snapshot?: unknown }).snapshot ?? body
        : body;
    const result = await publishLocalShoplingCategorySnapshot(source);
    return Response.json(
      {
        ok: true,
        status: "success",
        requestId: result.snapshot.requestId,
        categoryCount: result.snapshot.categoryCount,
        collectedAt: result.snapshot.collectedAt,
        hash: result.snapshot.hash,
        commitSha: result.commitSha,
        message: result.status.message,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "로컬 카테고리 결과를 저장하지 못했습니다.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
