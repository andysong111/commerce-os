import { INVENTORY_STOCKOUT_RESET_OPERATION_TYPE, loadInventoryStockControlReport } from "@/lib/inventoryStockControl";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function projectRef() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  try {
    const host = new URL(raw).hostname;
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return Response.json({ ok: false, projectRef: projectRef(), error: "SUPABASE_ADMIN_NOT_CONFIGURED" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const raw = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at,status")
    .eq("operation_type", INVENTORY_STOCKOUT_RESET_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: true })
    .limit(20);

  const report = await loadInventoryStockControlReport().catch((error) => ({
    state: "THREW",
    message: error instanceof Error ? error.message : String(error),
  }));

  return Response.json(
    {
      ok: !raw.error,
      projectRef: projectRef(),
      rawError: raw.error?.message || null,
      rawCount: Array.isArray(raw.data) ? raw.data.length : null,
      rawRows: Array.isArray(raw.data)
        ? raw.data.map((row) => ({
            sourceEventId: (row as Record<string, unknown>).source_event_id ?? null,
            inputSnapshot: (row as Record<string, unknown>).input_snapshot ?? null,
            resultSnapshot: (row as Record<string, unknown>).result_snapshot ?? null,
            startedAt: (row as Record<string, unknown>).started_at ?? null,
            status: (row as Record<string, unknown>).status ?? null,
          }))
        : null,
      report,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
