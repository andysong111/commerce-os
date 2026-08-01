import { NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import { pushProductMasterSnapshotFromTrackerState } from "@/lib/productMasterSync";

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }

  const config = getProductLaunchAdminConfig();
  if (!config.ok) {
    return Response.json(config.body, { status: config.status });
  }

  try {
    const stored = await readProductLaunchState(
      config.value,
      identity.value.userId,
    );
    const state = stored?.state_payload;
    if (!state || typeof state !== "object") {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_STATE_REQUIRED",
          message: "먼저 신규 상품 출시 진행관리 데이터를 저장해 주세요.",
        },
        { status: 409 },
      );
    }

    const result = await pushProductMasterSnapshotFromTrackerState(state);
    return Response.json({
      ok: true,
      ...result,
      message:
        `상품 ${result.counts.products ?? 0}개, SKU ${result.counts.skus ?? 0}개, ` +
        `샵플링 연결 ${result.counts.listingMappings ?? 0}개, ` +
        `확정 입고원가 ${result.counts.receiptCosts ?? 0}개를 상품마스터에 저장했습니다.`,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "UNKNOWN_PRODUCT_MASTER_SYNC_ERROR";
    const missingSecret = detail === "PRODUCT_MASTER_INTEGRATION_SECRET_MISSING";
    return Response.json(
      {
        ok: false,
        code: missingSecret
          ? "PRODUCT_MASTER_INTEGRATION_NOT_CONFIGURED"
          : "PRODUCT_MASTER_SYNC_FAILED",
        message: missingSecret
          ? "OPS Center에 PRODUCT_MASTER_INTEGRATION_SECRET 환경변수를 설정해 주세요."
          : `상품마스터 동기화에 실패했습니다: ${detail}`,
      },
      { status: missingSecret ? 503 : 502 },
    );
  }
}
