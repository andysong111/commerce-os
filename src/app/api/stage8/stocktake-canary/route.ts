import { NextRequest } from "next/server";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import {
  applyStocktakeCanaryFromOperator,
  loadStocktakeCanaryOperatorReadiness,
  stocktakeOperatorProxyWriteEnabled,
} from "@/lib/stage8StocktakeCanaryOperator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : "UNKNOWN_STOCKTAKE_CANARY_ERROR")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 1000);
}

export async function GET(request: NextRequest) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      { ok: false, error: "SAME_ORIGIN_REQUIRED", message: "Ops Center 화면에서만 확인할 수 있습니다." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const readiness = await loadStocktakeCanaryOperatorReadiness();
    return Response.json(
      { ok: true, readiness },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: "STOCKTAKE_CANARY_READINESS_FAILED", message: safeMessage(error) },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      { ok: false, error: "SAME_ORIGIN_REQUIRED", message: "Ops Center 화면에서만 실행할 수 있습니다." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  if (!stocktakeOperatorProxyWriteEnabled()) {
    return Response.json(
      {
        ok: false,
        error: "STOCKTAKE_CANARY_OPERATOR_WRITE_GATE_OFF",
        message: "Ops Center 브라우저 STOCKTAKE canary write 프록시는 별도 환경 게이트로 잠겨 있습니다.",
        maxWriteRows: 1,
        purchaseWritesEnabled: false,
        priceWritesEnabled: false,
        receiptWritesEnabled: false,
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          physicalQuantity?: unknown;
          expectedPlanFingerprint?: unknown;
          expectedInventoryGuard?: unknown;
          confirmation?: unknown;
        }
      | null;
    if (String(body?.confirmation ?? "") !== "APPLY_ONE_STOCKTAKE_CANARY") {
      return Response.json(
        {
          ok: false,
          error: "STOCKTAKE_CANARY_CONFIRMATION_REQUIRED",
          message: "정확히 1건 STOCKTAKE canary 적용 확인값이 필요합니다.",
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const result = await applyStocktakeCanaryFromOperator({
      physicalQuantity: body?.physicalQuantity,
      expectedPlanFingerprint: body?.expectedPlanFingerprint,
      expectedInventoryGuard: body?.expectedInventoryGuard,
    });
    return Response.json(
      {
        ok: true,
        result,
        maxWriteRows: 1,
        purchaseWritesEnabled: false,
        priceWritesEnabled: false,
        receiptWritesEnabled: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = safeMessage(error);
    const precondition =
      message.includes("PRECONDITION") ||
      message.includes("NOT_READY") ||
      message.includes("INVENTORY_CHANGED") ||
      message.includes("NOT_ELIGIBLE");
    const disabled =
      message.includes("WRITE_DISABLED") ||
      message.includes("WRITE_GATE_OFF");
    return Response.json(
      {
        ok: false,
        error: disabled
          ? "STOCKTAKE_CANARY_WRITE_DISABLED"
          : precondition
            ? "STOCKTAKE_CANARY_PRECONDITION_CHANGED"
            : "STOCKTAKE_CANARY_APPLY_FAILED",
        message,
        maxWriteRows: 1,
      },
      {
        status: disabled ? 403 : precondition ? 409 : 400,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
