import { NextRequest } from "next/server";
import { fetchShoplingCategorySnapshot } from "@/lib/shoplingCategoryCatalog";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }

  try {
    const snapshot = await fetchShoplingCategorySnapshot();
    if (!snapshot?.categories?.length) {
      return Response.json(
        { ok: false, message: "샵플링 카테고리 스냅샷이 비어 있습니다." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      {
        ok: true,
        hash: snapshot.hash,
        collectedAt: snapshot.collectedAt,
        categoryCount: snapshot.categoryCount,
        categories: snapshot.categories.map((entry) => ({
          path: entry.path,
          names: entry.names,
          codes: entry.codes,
          depth: entry.depth,
        })),
      },
      {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "샵플링 카테고리 목록을 불러오지 못했습니다.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
