import { NextRequest } from "next/server";
import { runProductLaunchNormalizedCutover } from "@/lib/productLaunchTrackerNormalizedCutover";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("disable") === "1"
    ? "disable"
    : request.nextUrl.searchParams.get("apply") === "1"
      ? "apply"
      : "audit";
  try {
    return await runProductLaunchNormalizedCutover(request, action);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_NORMALIZED_CUTOVER_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상품출시진행관리 정규화 DB 전환을 완료하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
