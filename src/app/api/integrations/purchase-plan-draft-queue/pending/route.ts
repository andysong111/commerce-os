import { NextResponse } from "next/server";
import { readPendingPurchasePlanDrafts } from "@/lib/purchasePlanDraftQueue";

const INTEGRATION_HEADER = "x-commerce-os-integration-secret";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  try {
    const sourceRunId = new URL(request.url).searchParams.get("sourceRunId");
    const entries = await readPendingPurchasePlanDrafts(sourceRunId);
    return NextResponse.json({ ok: true, entries, count: entries.length });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "PURCHASE_DRAFT_RELAY_READ_FAILED",
        message: error instanceof Error ? error.message : "대기 중인 발주안을 읽지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

function authorize(request: Request) {
  const expected = [
    process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET,
    process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET,
  ]
    .map((value) => value?.trim())
    .filter(Boolean) as string[];
  if (!expected.length) {
    return {
      ok: false as const,
      status: 503,
      body: {
        ok: false,
        code: "PURCHASE_DRAFT_RELAY_SECRET_REQUIRED",
        message: "중국 발주 수신 인증값이 설정되지 않았습니다.",
      },
    };
  }
  const supplied = request.headers.get(INTEGRATION_HEADER)?.trim() ?? "";
  if (!supplied || !expected.includes(supplied)) {
    return {
      ok: false as const,
      status: 401,
      body: {
        ok: false,
        code: "INVALID_PURCHASE_DRAFT_RELAY_SECRET",
        message: "중국 발주 수신 인증에 실패했습니다.",
      },
    };
  }
  return { ok: true as const };
}
