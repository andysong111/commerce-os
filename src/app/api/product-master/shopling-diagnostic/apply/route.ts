import {
  applyProductMasterShoplingMappings,
  loadProductMasterShoplingMappingApplyStatus,
} from "@/lib/productMasterShoplingMappingApply";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "PRODUCT_MASTER_SHOPLING_MAPPING_UNAUTHORIZED",
      message: "상품마스터 Shopling 연결값 적용 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    return Response.json(
      { ok: true, status: await loadProductMasterShoplingMappingApplyStatus() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_MAPPING_STATUS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상품마스터 Shopling 연결 적용 상태를 불러오지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
  };
  const action = String(body.action ?? "").trim().toLowerCase();
  if (action !== "canary" && action !== "full") {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_MAPPING_ACTION_INVALID",
        message: "canary 또는 full 적용 동작을 선택해야 합니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await applyProductMasterShoplingMappings(
      action === "canary" ? "CANARY" : "FULL",
    );
    return Response.json(
      { ok: true, result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "상품마스터 Shopling 연결값 적용에 실패했습니다.";
    const blocked = /BLOCKED|CANARY_REQUIRED|DIAGNOSTIC_NOT_COMPLETED/.test(
      message,
    );
    const configuration = /INTEGRATION_SECRET|BASE_URL|SUPABASE_ADMIN/.test(
      message,
    );
    return Response.json(
      {
        ok: false,
        code: blocked
          ? "PRODUCT_MASTER_SHOPLING_MAPPING_BLOCKED"
          : configuration
            ? "PRODUCT_MASTER_SHOPLING_MAPPING_NOT_CONFIGURED"
            : "PRODUCT_MASTER_SHOPLING_MAPPING_APPLY_FAILED",
        message,
      },
      {
        status: blocked ? 409 : configuration ? 503 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
