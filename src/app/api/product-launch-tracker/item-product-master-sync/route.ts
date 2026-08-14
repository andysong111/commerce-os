import { NextRequest } from "next/server";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";
import { syncProductLaunchItemPurchaseMetadataToProductMaster } from "@/lib/productLaunchPurchaseMetadataWrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }

  const body = (await request.json().catch(() => null)) as {
    itemId?: unknown;
  } | null;
  if (!body?.itemId) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_ITEM_ID_REQUIRED",
        message: "상품마스터에 동기화할 상품 ID가 필요합니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await syncProductLaunchItemPurchaseMetadataToProductMaster({
      identity: identity.value,
      itemId: body.itemId,
    });
    return Response.json(
      {
        ok: result.productMaster.ok,
        ...result,
        message: result.productMaster.ok
          ? "상품출시에서 마지막으로 저장한 1번 중국링크·중국옵션을 상품마스터 최신 원장에 반영했습니다."
          : `상품출시 저장은 완료됐지만 상품마스터 최신 원장 동기화가 필요합니다: ${result.productMaster.error}`,
      },
      {
        status: result.productMaster.ok ? 200 : 502,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "PRODUCT_MASTER_PURCHASE_METADATA_SYNC_FAILED";
    const notFound = message.includes("NOT_FOUND");
    return Response.json(
      {
        ok: false,
        code: notFound
          ? "PRODUCT_LAUNCH_ITEM_NOT_FOUND"
          : "PRODUCT_MASTER_PURCHASE_METADATA_SYNC_FAILED",
        message,
      },
      {
        status: notFound ? 404 : 502,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
