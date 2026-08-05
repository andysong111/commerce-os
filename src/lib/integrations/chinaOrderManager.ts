import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ChinaOrderInternalStatus = {
  sourceMode: "ops_ledger" | "empty";
  latestOperationAt: string | null;
  operationCount: number;
  succeededCount: number;
  failedCount: number;
  writesEnabled: false;
  error: string | null;
};

type OperationRow = {
  operation_type?: unknown;
  source?: unknown;
  status?: unknown;
  started_at?: unknown;
};

function isChinaOrderOperation(row: OperationRow) {
  const identity = `${String(row.operation_type ?? "")} ${String(row.source ?? "")}`
    .toUpperCase();
  return (
    identity.includes("CHINA") ||
    identity.includes("RECEIPT") ||
    identity.includes("INBOUND")
  );
}

export async function loadChinaOrderInternalStatus(): Promise<ChinaOrderInternalStatus> {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return {
      sourceMode: "empty",
      latestOperationAt: null,
      operationCount: 0,
      succeededCount: 0,
      failedCount: 0,
      writesEnabled: false,
      error: "Ops Center 운영 원장 연결이 설정되지 않았습니다.",
    };
  }

  const result = await admin
    .from("commerce_operation_runs")
    .select("operation_type,source,status,started_at")
    .order("started_at", { ascending: false })
    .limit(200);

  if (result.error) {
    return {
      sourceMode: "empty",
      latestOperationAt: null,
      operationCount: 0,
      succeededCount: 0,
      failedCount: 0,
      writesEnabled: false,
      error: result.error.message,
    };
  }

  const rows = (Array.isArray(result.data) ? result.data : [])
    .filter((row): row is OperationRow => Boolean(row && typeof row === "object"))
    .filter(isChinaOrderOperation);
  return {
    sourceMode: rows.length ? "ops_ledger" : "empty",
    latestOperationAt:
      rows.length && typeof rows[0]?.started_at === "string"
        ? rows[0].started_at
        : null,
    operationCount: rows.length,
    succeededCount: rows.filter((row) => row.status === "SUCCEEDED").length,
    failedCount: rows.filter((row) => row.status === "FAILED").length,
    writesEnabled: false,
    error: null,
  };
}
