import {
  loadProductMasterShoplingSalesIncrementalStatus,
  runProductMasterShoplingSalesIncrementalStep,
} from "@/lib/productMasterShoplingSalesIncremental";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_UNAUTHORIZED",
      message: "상품마스터 Shopling 증분 판매원장 작업 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    return Response.json(
      {
        ok: true,
        status: await loadProductMasterShoplingSalesIncrementalStatus(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_STATUS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 증분 판매원장 상태를 불러오지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = String(body.action ?? "").trim().toLowerCase();
  if (action !== "run-next") {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_ACTION_INVALID",
        message: "run-next 작업만 허용됩니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    return Response.json(
      {
        ok: true,
        result: await runProductMasterShoplingSalesIncrementalStep(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_RUN_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 증분 판매원장 단일 단계 실행에 실패했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
