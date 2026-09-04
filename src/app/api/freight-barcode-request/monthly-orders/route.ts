import { loadMonthlyFreightBarcodeOrderLines } from "@/lib/monthlyFreightBarcodeBridge";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedMonth = url.searchParams.get("month")?.trim() ?? "";
  const month = /^\d{4}-\d{2}$/.test(requestedMonth)
    ? requestedMonth
    : seoulCalendarMonth(new Date());

  try {
    const data = await loadMonthlyFreightBarcodeOrderLines(month);
    return Response.json(
      { ok: true, ...data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        cycleMonth: month,
        lineCount: 0,
        orderCount: 0,
        totalQuantity: 0,
        lines: [],
        error:
          error instanceof Error
            ? error.message
            : "MONTHLY_FREIGHT_BARCODE_LOAD_FAILED",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
