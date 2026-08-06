import {
  createProductMasterShoplingDiagnosticRequest,
  loadProductMasterShoplingDiagnosticStatus,
  productMasterShoplingDiagnosticConfigured,
  runProductMasterShoplingDiagnosticStep,
} from "@/lib/productMasterShoplingDiagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LEGACY_FAILED_RANGE = "2000-01-01:2000-12-30";

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  return Boolean(expected && authorization === `Bearer ${expected}`);
}

function safeCatalogStartDate(now = new Date()) {
  const configured = process.env.SHOPLING_CATALOG_START_DATE?.trim();
  if (configured) return configured;
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 23, 1),
  );
  return start.toISOString().slice(0, 10);
}

function prepareSafeCatalogWindow() {
  if (!process.env.SHOPLING_CATALOG_START_DATE?.trim()) {
    process.env.SHOPLING_CATALOG_START_DATE = safeCatalogStartDate();
  }
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
    prepareSafeCatalogWindow();
    const current = await loadProductMasterShoplingDiagnosticStatus();
    const legacyFailed =
      current.state === "FAILED" &&
      (current.message.includes(LEGACY_FAILED_RANGE) ||
        current.error?.includes(LEGACY_FAILED_RANGE));
    if (current.state === "IDLE" || legacyFailed) {
      const created = await createProductMasterShoplingDiagnosticRequest();
      return Response.json(
        {
          ok: true,
          configured: true,
          processed: true,
          state: "QUEUED",
          requestId: created.requestId,
          totalRanges: created.ranges.length,
          message: legacyFailed
            ? "과거 2000년부터 조회하던 실패 실행을 종료하고 최근 24개월 기준으로 전수진단을 다시 접수했습니다. 다음 1분 Worker부터 기간별 조회를 시작합니다."
            : "최초 상품마스터 Shopling 전수진단을 자동 접수했습니다. 다음 1분 Worker부터 기간별 조회를 시작합니다.",
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

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
