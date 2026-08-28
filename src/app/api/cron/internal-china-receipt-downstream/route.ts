import { runInternalChinaReceiptDownstreamStep } from "@/lib/internalChinaReceiptDownstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    return Response.json(
      {
        ok: true,
        ...(await runInternalChinaReceiptDownstreamStep()),
        shoplingPriceWritesEnabled: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INTERNAL_CHINA_RECEIPT_DOWNSTREAM_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "중국 입고 후속 처리 Worker 실행에 실패했습니다.",
        shoplingPriceWritesEnabled: false,
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
