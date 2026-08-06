import {
  productMasterShoplingDiagnosticConfigured,
  runProductMasterShoplingDiagnosticStep,
} from "@/lib/productMasterShoplingDiagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  return Boolean(expected && authorization === `Bearer ${expected}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  if (!productMasterShoplingDiagnosticConfigured()) {
    return Response.json(
      {
        ok: true,
        configured: false,
        processed: false,
        state: "IDLE",
        message:
          "상품마스터 Shopling 전수진단 환경변수가 준비되지 않아 작업을 실행하지 않았습니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    return Response.json(
      {
        ok: true,
        configured: true,
        ...(await runProductMasterShoplingDiagnosticStep()),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상품마스터 Shopling 전수진단 Worker 실행에 실패했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
