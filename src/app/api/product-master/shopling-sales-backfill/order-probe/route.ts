import {
  loadLatestProductMasterShoplingOrderProbe,
  runProductMasterShoplingOrderProbe,
} from "@/lib/productMasterShoplingOrderProbe";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "SHOPLING_ORDER_PROBE_UNAUTHORIZED",
      message: "Shopling 주문 읽기 진단 권한이 필요합니다.",
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
        result: await loadLatestProductMasterShoplingOrderProbe(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_ORDER_PROBE_STATUS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 주문 읽기 진단 결과를 불러오지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    startDate?: unknown;
    endDate?: unknown;
  } | null;
  if (String(body?.action ?? "") !== "probe") {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_ORDER_PROBE_ACTION_INVALID",
        message: "지원하지 않는 Shopling 주문 진단 작업입니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const result = await runProductMasterShoplingOrderProbe({
      start: String(body?.startDate ?? "").trim() || undefined,
      end: String(body?.endDate ?? "").trim() || undefined,
    });
    return Response.json(
      {
        ok: true,
        result,
        message: result.safeMessage,
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
        : "Shopling 주문 읽기 진단을 실행하지 못했습니다.";
    const invalidRange = /DATE_INVALID|RANGE_TOO_WIDE/.test(message);
    return Response.json(
      {
        ok: false,
        code: invalidRange
          ? "SHOPLING_ORDER_PROBE_RANGE_INVALID"
          : "SHOPLING_ORDER_PROBE_FAILED",
        message,
      },
      {
        status: invalidRange ? 400 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
