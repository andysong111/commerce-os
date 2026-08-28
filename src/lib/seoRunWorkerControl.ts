import {
  SUPABASE_ADMIN_RPC_TIMEOUT_MS,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";
import {
  readProductLaunchError,
  readResponseJson,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";

type UnknownRecord = Record<string, unknown>;

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
    signal: AbortSignal.timeout(SUPABASE_ADMIN_RPC_TIMEOUT_MS),
  });
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  return body as T;
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
