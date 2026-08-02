import {
  processReceiptAutomationEvent,
  validateReceiptAutomationEvent,
} from "@/lib/receiptAutomationControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const INTEGRATION_HEADER = "x-commerce-os-integration-secret";

export async function POST(request: Request) {
  const expected = process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET?.trim();
  const supplied = request.headers.get(INTEGRATION_HEADER)?.trim() ?? "";
  if (!expected) {
    return Response.json(
      {
        ok: false,
        code: "RECEIPT_AUTOMATION_SECRET_NOT_CONFIGURED",
        message: "Ops Center 입고확정 자동화 비밀값이 설정되지 않았습니다.",
      },
      { status: 503 },
    );
  }
  if (supplied !== expected) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_RECEIPT_AUTOMATION_SECRET",
        message: "입고확정 자동화 인증에 실패했습니다.",
      },
      { status: 401 },
    );
  }

  try {
    const event = validateReceiptAutomationEvent(
      await request.json().catch(() => null),
    );
    return Response.json(await processReceiptAutomationEvent(event));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "입고확정 자동화를 처리하지 못했습니다.";
    const invalid =
      message.includes("올바르지") ||
      message.includes("필요합니다") ||
      message.includes("지원하지") ||
      message.includes("RECEIVED");
    return Response.json(
      {
        ok: false,
        code: invalid
          ? "INVALID_RECEIPT_AUTOMATION_EVENT"
          : "RECEIPT_AUTOMATION_FAILED",
        message,
      },
      { status: invalid ? 400 : 502 },
    );
  }
}
