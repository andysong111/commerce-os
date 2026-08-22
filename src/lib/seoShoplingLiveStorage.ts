import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchError,
  readResponseJson,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";
import type { SeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";

async function request<T>(
  config: ProductLaunchAdminConfig,
  path: string,
  init: RequestInit = {},
) {
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

export async function patchSeoLiveDispatchItemsForGroup(
  context: SeoTitleLedgerContext,
  dispatchId: string,
  productGroup: string,
  patch: Record<string, unknown>,
) {
  const params = new URLSearchParams({
    owner_id: `eq.${context.identity.userId}`,
    dispatch_id: `eq.${dispatchId}`,
    product_group: `eq.${productGroup}`,
  });
  return request<Array<Record<string, unknown>>(
    context.config,
    `seo_title_dispatch_items?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
}

export async function listActiveSeoLiveDispatches(
  config: ProductLaunchAdminConfig,
  limit = 5,
) {
  const params = new URLSearchParams({
    select: "*",
    status: "eq.submitted",
    order: "updated_at.asc",
    limit: String(Math.max(1, Math.min(10, Math.trunc(limit)))),
  });
  const rows = await request<Array<Record<string, unknown>>(
    config,
    `seo_title_dispatches?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows : [];
}

export async function readSeoLiveDispatchItems(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  dispatchId: string,
) {
  const params = new URLSearchParams({
    select: "*",
    owner_id: `eq.${ownerId}`,
    dispatch_id: `eq.${dispatchId}`,
    order: "product_group.asc,created_at.asc",
    limit: "100",
  });
  const rows = await request<Array<Record<string, unknown>>(
    config,
    `seo_title_dispatch_items?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows : [];
}

export async function patchSeoLiveDispatchByOwner(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  dispatchId: string,
  patch: Record<string, unknown>,
) {
  const params = new URLSearchParams({
    owner_id: `eq.${ownerId}`,
    dispatch_id: `eq.${dispatchId}`,
  });
  const rows = await request<Array<Record<string, unknown>>(
    config,
    `seo_title_dispatches?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function patchSeoLiveDispatchItemsByOwner(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  dispatchId: string,
  patch: Record<string, unknown>,
) {
  const params = new URLSearchParams({
    owner_id: `eq.${ownerId}`,
    dispatch_id: `eq.${dispatchId}`,
  });
  return request<Array<Record<string, unknown>>(
    config,
    `seo_title_dispatch_items?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
}

export async function callSeoLiveRpc<T>(
  config: ProductLaunchAdminConfig,
  name: string,
  parameters: Record<string, unknown>,
) {
  return request<T>(config, `rpc/${encodeURIComponent(name)}`, {
    method: "POST",
    body: JSON.stringify(parameters),
  });
}
