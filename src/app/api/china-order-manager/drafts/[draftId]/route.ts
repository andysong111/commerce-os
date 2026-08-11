import {
  loadInternalChinaPurchaseDraft,
  markInternalChinaPurchaseDraftOrdered,
  saveInternalChinaPurchaseDraft,
  type InternalChinaPurchaseDraftInput,
} from "@/lib/internalChinaPurchaseDraft";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

type RouteContext = {
  params: Promise<{ draftId: string }>;
};

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INTERNAL_CHINA_DRAFT_UNAUTHORIZED",
      message: "Ops Center 동일 출처 화면에서만 중국 발주초안을 사용할 수 있습니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function errorResponse(error: unknown) {
  const raw = error instanceof Error ? error.message : "INTERNAL_CHINA_DRAFT_FAILED";
  const code = raw.split(":", 1)[0] || "INTERNAL_CHINA_DRAFT_FAILED";
  let message = raw;
  if (code === "INTERNAL_CHINA_DRAFT_NOT_FOUND") {
    message = "해당 내부 발주 Draft를 찾지 못했습니다.";
  } else if (code === "INTERNAL_CHINA_DRAFT_ALREADY_ORDERED") {
    message = "이미 실제 주문완료로 기록된 Draft입니다.";
  } else if (code === "INTERNAL_CHINA_EXCHANGE_RATE_INVALID") {
    message = "적용 환율을 확인하세요.";
  } else if (code === "INTERNAL_CHINA_QUANTITY_LOCKED") {
    message = "빠른 발주안에서 RESERVED로 고정한 주문수량은 이 화면에서 변경하지 않습니다.";
  } else if (code === "INTERNAL_CHINA_ORDER_REQUIRED") {
    message = `실제 주문완료 기록 전에 필수값을 확인하세요. ${raw.split(":").slice(1).join(":")}`;
  }
  const notFound = code === "INTERNAL_CHINA_DRAFT_NOT_FOUND";
  return Response.json(
    { ok: false, code, message, externalOrderExecuted: false },
    {
      status: notFound ? 404 : 400,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function GET(request: Request, context: RouteContext) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const { draftId } = await context.params;
  try {
    const draft = await loadInternalChinaPurchaseDraft(decodeURIComponent(draftId));
    return Response.json(
      { ok: true, draft, externalOrderExecuted: false },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const { draftId } = await context.params;
  try {
    const input = (await request.json()) as InternalChinaPurchaseDraftInput;
    const draft = await saveInternalChinaPurchaseDraft(
      decodeURIComponent(draftId),
      input,
    );
    return Response.json(
      {
        ok: true,
        draft,
        message: "Ops Center 중국 발주초안을 저장했습니다. 실제 1688 주문·결제는 실행하지 않았습니다.",
        externalOrderExecuted: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const { draftId } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      prep?: InternalChinaPurchaseDraftInput;
    };
    if (String(body.action ?? "") !== "MARK_ORDERED") {
      return Response.json(
        {
          ok: false,
          code: "INTERNAL_CHINA_ACTION_INVALID",
          message: "지원하지 않는 중국 발주초안 작업입니다.",
          externalOrderExecuted: false,
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const result = await markInternalChinaPurchaseDraftOrdered(
      decodeURIComponent(draftId),
      body.prep ?? {},
    );
    return Response.json(
      {
        ok: true,
        ...result,
        message: result.duplicate
          ? "이미 실제 1688 주문완료로 기록된 Draft입니다."
          : "실제 1688 주문을 완료한 것으로 Ops Center 원장에 기록했습니다. 이 버튼 자체가 1688 주문·결제를 실행한 것은 아닙니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
