import {
  createProductMasterShoplingDiagnosticRequest,
  loadProductMasterShoplingDiagnosticStatus,
  runProductMasterShoplingDiagnosticStep,
} from "@/lib/productMasterShoplingDiagnostic";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  return isSameOriginOpsRequest(request);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_UNAUTHORIZED",
        message: "상품마스터 Shopling 전수진단 상태를 조회할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return Response.json(
      { ok: true, status: await loadProductMasterShoplingDiagnosticStatus() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_STATUS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상품마스터 Shopling 전수진단 상태를 불러오지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_UNAUTHORIZED",
        message: "상품마스터 Shopling 전수진단을 실행할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
    };
    if (String(body.action ?? "").trim() === "run-next") {
      return Response.json(
        { ok: true, result: await runProductMasterShoplingDiagnosticStep() },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const current = await loadProductMasterShoplingDiagnosticStatus();
    if (current.state === "QUEUED" || current.state === "RUNNING") {
      return Response.json(
        {
          ok: true,
          accepted: false,
          alreadyActive: true,
          status: current,
          message: "이미 상품마스터 Shopling 전수진단이 진행 중입니다.",
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const created = await createProductMasterShoplingDiagnosticRequest();
    return Response.json(
      {
        ok: true,
        accepted: true,
        requestId: created.requestId,
        totalRanges: created.ranges.length,
        message:
          "전수진단을 접수했습니다. 1분 예약 Worker가 Shopling 상품·옵션을 기간별로 읽습니다.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "상품마스터 Shopling 전수진단을 시작하지 못했습니다.";
    const configurationError = /CREDENTIAL|PRODUCT_MASTER|SUPABASE_ADMIN|CATALOG_START_DATE/.test(
      message,
    );
    return Response.json(
      {
        ok: false,
        code: configurationError
          ? "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_NOT_CONFIGURED"
          : "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REQUEST_FAILED",
        message,
      },
      {
        status: configurationError ? 503 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
