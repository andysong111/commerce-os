import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchError,
  readResponseJson,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function mallTitles(value: unknown) {
  const root = record(value);
  const seoFinal = record(root.seoFinal || record(root.result).seoFinal);
  return array(seoFinal.mallTitles)
    .map(record)
    .map((row) => text(row.title))
    .filter(Boolean);
}

export async function listHistoricalSeoRunTitles(input: {
  config: ProductLaunchAdminConfig;
  ownerId: string;
  launchItemId: string;
  excludeRunId?: string;
  limit?: number;
}) {
  const params = new URLSearchParams({
    select: "run_id,result_payload",
    owner_id: `eq.${input.ownerId}`,
    launch_item_id: `eq.${input.launchItemId}`,
    status: "eq.ready",
    order: "run_created_at.asc",
    limit: String(Math.max(1, Math.min(1000, Math.trunc(input.limit ?? 500)))),
  });
  if (input.excludeRunId) params.set("run_id", `neq.${input.excludeRunId}`);
  const response = await fetch(
    `${input.config.supabaseUrl}/rest/v1/seo_run_jobs?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(input.config.secretKey),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  const titles: string[] = [];
  for (const row of Array.isArray(body) ? body : []) {
    titles.push(...mallTitles(record(row).result_payload));
  }
  return [...new Set(titles)].slice(0, 1200);
}
