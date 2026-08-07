import {
  applyProductMasterShoplingSales,
  createProductMasterShoplingSalesRequest,
  loadProductMasterShoplingSalesStatus,
  runProductMasterShoplingSalesStep,
} from "@/lib/productMasterShoplingSalesBackfill";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "PRODUCT_MASTER_SHOPLING_SALES_UNAUTHORIZED",
      message: "상품마스터 Shopling 판매원장 작업 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function zeroSourceBlocked(status: Awaited<ReturnType<typeof loadProductMasterShoplingSalesStatus>>) {
  return (
    status.completedRanges > 0 &&
    status.fetchedRows === 0 &&
    status.acceptedRows === 0 &&
    status.monthlyRowCount === 0
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const status = await loadProductMasterShoplingSalesStatus();
    return Response.json(
      {
        ok: true,
        status,
        zeroSourceBlocked: zeroSourceBlocked(status),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_SALES_STATUS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 판매원장 상태를 불러오지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = String(body.action ?? "").trim().toLowerCase();
  try {
    if (action === "start") {
      const current = await loadProductMasterShoplingSalesStatus();
      if (current.state === "QUEUED" || current.state === "RUNNING") {
        return Response.json({ ok: true, accepted: false, alreadyActive: true, status: current });
      }
      const created = await createProductMasterShoplingSalesRequest();
      return Response.json(
        {
          ok: true,
          accepted: true,
          requestId: created.requestId,
          totalRanges: created.ranges.length,
          message: "최근 24개월 Shopling 판매원장 읽기 작업을 접수했습니다.",
        },
        { status: 202, headers: { "cache-control": "no-store" } },
      );
    }
    if (action === "run-next") {
      return Response.json(
        { ok: true, result: await runProductMasterShoplingSalesStep() },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (action === "canary" || action === "full") {
      const current = await loadProductMasterShoplingSalesStatus();
      if (zeroSourceBlocked(current)) {
        return Response.json(
          {
            ok: false,
            code: "PRODUCT_MASTER_SHOPLING_SALES_ZERO_SOURCE_ROWS",
            message:
              "Shopling 주문 API에서 원시 주문행을 0건 읽은 상태이므로 빈 판매이력을 정상값으로 상품마스터에 적재하지 않습니다. 주문 응답구조 진단을 먼저 통과해야 합니다.",
          },
          { status: 409, headers: { "cache-control": "no-store" } },
        );
      }
      const result = await applyProductMasterShoplingSales(
        action === "canary" ? "CANARY" : "FULL",
      );
      return Response.json(
        { ok: true, result },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_SALES_ACTION_INVALID",
        message: "start, canary 또는 full 작업을 선택해야 합니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Shopling 판매원장 작업에 실패했습니다.";
    const blocked = /BLOCKED|CANARY_REQUIRED|DIAGNOSTIC_NOT_COMPLETED|MAPPING_CHANGED|ZERO_SOURCE_ROWS/.test(
      message,
    );
    const configuration = /INTEGRATION_SECRET|BASE_URL|SUPABASE_ADMIN|CREDENTIAL/.test(
      message,
    );
    return Response.json(
      {
        ok: false,
        code: blocked
          ? "PRODUCT_MASTER_SHOPLING_SALES_BLOCKED"
          : configuration
            ? "PRODUCT_MASTER_SHOPLING_SALES_NOT_CONFIGURED"
            : "PRODUCT_MASTER_SHOPLING_SALES_FAILED",
        message,
      },
      {
        status: blocked ? 409 : configuration ? 503 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
