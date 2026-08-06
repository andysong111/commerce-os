import {
  loadLatestProductMasterShoplingProbe,
  runProductMasterShoplingProbe,
} from "@/lib/productMasterShoplingProbe";
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
        code: "SHOPLING_PRODUCT_PROBE_UNAUTHORIZED",
        message: "Shopling 연결 진단 결과를 조회할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return Response.json(
      {
        ok: true,
        result: await loadLatestProductMasterShoplingProbe(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_PRODUCT_PROBE_STATUS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 연결 진단 결과를 읽지 못했습니다.",
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
        code: "SHOPLING_PRODUCT_PROBE_UNAUTHORIZED",
        message: "Shopling 연결 진단을 실행할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    probeDate?: unknown;
  } | null;
  if (String(body?.action ?? "") !== "probe") {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_PRODUCT_PROBE_ACTION_INVALID",
        message: "지원하지 않는 Shopling 연결 진단 작업입니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const result = await runProductMasterShoplingProbe(
      String(body?.probeDate ?? "").trim() || undefined,
    );
    return Response.json(
      {
        ok: true,
        result,
        message: result.ok
          ? "Shopling 상품 API 하루 범위 연결 확인에 성공했습니다."
          : "Shopling 상품 API 연결 실패 원인을 안전한 범위에서 분류했습니다.",
      },
      {
        status: result.ok ? 200 : 502,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Shopling 연결 진단을 실행하지 못했습니다.";
    return Response.json(
      {
        ok: false,
        code: /DATE_INVALID/.test(message)
          ? "SHOPLING_PRODUCT_PROBE_DATE_INVALID"
          : "SHOPLING_PRODUCT_PROBE_FAILED",
        message,
      },
      {
        status: /DATE_INVALID/.test(message) ? 400 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
