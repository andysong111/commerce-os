import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type OperationRun = {
  id: string;
  operation_type: string;
  status: string;
  source: string;
  correlation_id: string;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};

type DataSourceStatus = "FRESH" | "STALE" | "MISSING" | "FAILED";

type DataSourceHealth = {
  source_key: string;
  status: DataSourceStatus;
  generated_at: string | null;
  received_at: string;
  max_age_minutes: number;
  details: Record<string, unknown> | null;
  updated_at: string;
};

type PriceBulkJob = {
  id: string;
  status: string;
  valid_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type DashboardSnapshot = {
  configured: boolean;
  error: string | null;
  runs: OperationRun[];
  sources: DataSourceHealth[];
  priceJobs: PriceBulkJob[];
};

export type OperationsDashboardData = {
  configured: boolean;
  error: string | null;
  runs: OperationRun[];
  sources: Array<
    DataSourceHealth & {
      effectiveStatus: DataSourceStatus;
      ageMinutes: number | null;
    }
  >;
  priceJobs: PriceBulkJob[];
  summary: {
    running: number;
    awaitingApproval: number;
    failed: number;
    staleSources: number;
    pendingPriceJobs: number;
  };
};

const DASHBOARD_REVALIDATE_SECONDS = 15;

const loadOperationsDashboardSnapshot = unstable_cache(
  async (): Promise<DashboardSnapshot> => {
    const admin = await createSupabaseAdminClient();
    if (!admin) {
      return {
        configured: false,
        error: "Supabase 운영 연결이 설정되지 않았습니다.",
        runs: [],
        sources: [],
        priceJobs: [],
      };
    }

    const [runsResult, healthResult, priceJobsResult] = await Promise.all([
      admin
        .from("commerce_operation_runs")
        .select(
          "id,operation_type,status,source,correlation_id,error_message,started_at,finished_at,created_at",
        )
        .order("started_at", { ascending: false })
        .limit(50),
      admin
        .from("commerce_data_source_health")
        .select(
          "source_key,status,generated_at,received_at,max_age_minutes,details,updated_at",
        )
        .order("source_key", { ascending: true }),
      admin
        .from("shopling_price_adjustment_bulk_jobs")
        .select(
          "id,status,valid_count,last_error,created_at,updated_at,completed_at",
        )
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const errors = [runsResult.error, healthResult.error, priceJobsResult.error]
      .map((item) => item?.message)
      .filter(Boolean);

    return {
      configured: true,
      error: errors.length ? errors.join(" · ") : null,
      runs: errors.length ? [] : rows<OperationRun>(runsResult.data),
      sources: errors.length ? [] : rows<DataSourceHealth>(healthResult.data),
      priceJobs: errors.length ? [] : rows<PriceBulkJob>(priceJobsResult.data),
    };
  },
  ["commerce-operations-dashboard-v2"],
  { revalidate: DASHBOARD_REVALIDATE_SECONDS },
);

export async function loadOperationsDashboard(
  now = new Date(),
): Promise<OperationsDashboardData> {
  const snapshot = await loadOperationsDashboardSnapshot();
  if (!snapshot.configured) {
    return empty(false, snapshot.error || "Supabase 운영 연결이 설정되지 않았습니다.");
  }
  if (snapshot.error) return empty(true, snapshot.error);

  const runs = snapshot.runs;
  const sources = snapshot.sources.map((source) => {
    const generated = source.generated_at
      ? Date.parse(source.generated_at)
      : Number.NaN;
    const ageMinutes = Number.isFinite(generated)
      ? Math.max(0, Math.floor((now.valueOf() - generated) / 60_000))
      : null;
    const expired =
      ageMinutes === null || ageMinutes > Math.max(1, source.max_age_minutes);
    const effectiveStatus: DataSourceStatus =
      source.status === "FAILED"
        ? "FAILED"
        : source.status === "MISSING"
          ? "MISSING"
          : expired
            ? "STALE"
            : source.status;
    return { ...source, effectiveStatus, ageMinutes };
  });
  const priceJobs = snapshot.priceJobs;

  return {
    configured: true,
    error: null,
    runs,
    sources,
    priceJobs,
    summary: {
      running: runs.filter((run) => ["PENDING", "RUNNING"].includes(run.status))
        .length,
      awaitingApproval: runs.filter((run) => run.status === "AWAITING_APPROVAL")
        .length,
      failed: runs.filter((run) => run.status === "FAILED").length,
      staleSources: sources.filter((source) => source.effectiveStatus !== "FRESH")
        .length,
      pendingPriceJobs: priceJobs.filter((job) =>
        ["prepared", "running", "paused", "dispatch_uncertain"].includes(job.status),
      ).length,
    },
  };
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function empty(configured: boolean, error: string): OperationsDashboardData {
  return {
    configured,
    error,
    runs: [],
    sources: [],
    priceJobs: [],
    summary: {
      running: 0,
      awaitingApproval: 0,
      failed: 0,
      staleSources: 0,
      pendingPriceJobs: 0,
    },
  };
}
