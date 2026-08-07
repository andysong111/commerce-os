import { runProductMasterHistoricalReceiptBackfill } from "@/lib/productMasterHistoricalReceiptBackfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { snapshot?: unknown }
      | null;
    if (!body?.snapshot) {
      return Response.json(
        {
          ok: false,
          error: "HISTORICAL_RECEIPT_SNAPSHOT_REQUIRED",
          message: "과거 확정입고 추출 JSON 파일이 필요합니다.",
        },
        { status: 400 },
      );
    }
    const result = await runProductMasterHistoricalReceiptBackfill({
      mode: "diagnose",
      snapshot: body.snapshot,
    });
    return Response.json({
      ...result,
      proxyMode: "read-only-diagnose",
      productMasterWritesEnabled: false,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "HISTORICAL_RECEIPT_DIAGNOSIS_FAILED",
        message:
          error instanceof Error
            ? error.message.replace(/[\r\n\t]+/g, " ").slice(0, 1000)
            : "과거 확정입고 진단에 실패했습니다.",
      },
      { status: 502 },
    );
  }
}
