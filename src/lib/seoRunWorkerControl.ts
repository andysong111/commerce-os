import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchError,
  readResponseJson,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

export type SeoRunWorkerControlRow = {
  singleton: boolean;
  pulse_token: string;
  lease_owner: string | null;
  lease_until: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_result: UnknownRecord;
  updated_at: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function requestStorage<T>(
  config: ProductLaunchAdminConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...createSupabaseAdminHeaders(config.secretKey),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  return body as T;
}

export async function readSeoRunWorkerPulseToken(
  config: ProductLaunchAdminConfig,
) {
  const params = new URLSearchParams({
    select: "pulse_token",
    singleton: "eq.true",
    limit: "1",
  });
  const rows = await requestStorage<Array<{ pulse_token?: unknown }>>(
    config,
    `seo_run_worker_control?${params.toString()}`,
  );
  return text(Array.isArray(rows) ? rows[0]?.pulse_token : "");
}

export async function claimSeoRunWorkerPulse(
  config: ProductLaunchAdminConfig,
  workerId: string,
  leaseSeconds = 300,
) {
  return requestStorage<UnknownRecord>(config, "rpc/claim_seo_run_worker_pulse", {
    method: "POST",
    body: JSON.stringify({
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    }),
  });
}

export async function finishSeoRunWorkerPulse(
  config: ProductLaunchAdminConfig,
  workerId: string,
  result: UnknownRecord,
) {
  return requestStorage<UnknownRecord>(config, "rpc/finish_seo_run_worker_pulse", {
    method: "POST",
    body: JSON.stringify({
      p_worker_id: workerId,
      p_result: result,
    }),
  });
}
