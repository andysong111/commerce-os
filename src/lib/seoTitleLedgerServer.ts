import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readResponseJson,
  resolveProductLaunchIdentity,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

export type SeoTitleLedgerContext = {
  config: ProductLaunchAdminConfig;
  identity: ProductLaunchIdentity;
};

export type SeoTitleLedgerStatsRow = {
  ledger_id: string;
  owner_id: string;
  ledger_key: string;
  launch_item_id: string;
  tracker_row_number: number | null;
  model_number: string;
  source_url: string;
  offer_id: string;
  model_name: string;
  model_name_source: string;
  common_search_keywords: string[];
  common_search_line: string;
  engine_revision: string;
  target_inventory_count: number;
  status: string;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
  total_count: number;
  available_count: number;
  reserved_count: number;
  used_count: number;
  review_count: number;
  rejected_count: number;
  available_wholesale1: number;
  available_wholesale2: number;
  available_wholesale3: number;
  available_wholesale4: number;
  available_retail1: number;
  available_retail2: number;
  full_market_rounds_available: number;
  replenishment_needed_count: number;
  dispatch_count: number;
};

export type SeoTitleInventoryRow = {
  title_id: string;
  owner_id: string;
  ledger_id: string;
  product_group: string;
  title: string;
  title_fingerprint: string;
  semantic_fingerprint: string;
  generation_batch: number;
  quality_score: number;
  source_materials: string[];
  status: string;
  reservation_id: string | null;
  reservation_expires_at: string | null;
  dispatch_id: string | null;
  mall_key: string;
  goods_key: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SeoTitleLedgerRow = {
  ledger_id: string;
  owner_id: string;
  ledger_key: string;
  launch_item_id: string;
  tracker_row_number: number | null;
  model_number: string;
  source_url: string;
  offer_id: string;
  model_name: string;
  model_name_source: string;
  common_search_keywords: string[];
  common_search_line: string;
  source_payload: Record<string, unknown>;
  engine_revision: string;
  target_inventory_count: number;
  status: string;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function requireSeoTitleLedgerContext(request: Request) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return {
      ok: false as const,
      response: Response.json(identity.body, { status: identity.status }),
    };
  }
  const config = getProductLaunchAdminConfig();
  if (!config.ok) {
    return {
      ok: false as const,
      response: Response.json(config.body, { status: config.status }),
    };
  }
  return {
    ok: true as const,
    value: { identity: identity.value, config: config.value } satisfies SeoTitleLedgerContext,
  };
}

async function requestStorage<T>(
  context: SeoTitleLedgerContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${context.config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...createSupabaseAdminHeaders(context.config.secretKey),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  return body as T;
}

export async function callSeoTitleRpc<T>(
  context: SeoTitleLedgerContext,
  name: string,
  parameters: Record<string, unknown>,
) {
  return requestStorage<T>(context, `rpc/${encodeURIComponent(name)}`, {
    method: "POST",
    body: JSON.stringify(parameters),
  });
}

export async function listSeoTitleLedgers(
  context: SeoTitleLedgerContext,
  options: { search?: string; limit?: number } = {},
) {
  const params = new URLSearchParams({
    select: "*",
    owner_id: `eq.${context.identity.userId}`,
    order: "updated_at.desc",
    limit: String(Math.max(1, Math.min(500, Math.trunc(options.limit ?? 200)))),
  });
  const search = String(options.search ?? "").trim();
  if (search) {
    const escaped = search.replace(/[,%()]/g, "");
    params.set(
      "or",
      `(model_name.ilike.*${escaped}*,model_number.ilike.*${escaped}*,offer_id.ilike.*${escaped}*)`,
    );
  }
  const rows = await requestStorage<SeoTitleLedgerStatsRow[]>(
    context,
    `seo_title_ledger_inventory_stats?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows : [];
}

export async function readSeoTitleLedger(
  context: SeoTitleLedgerContext,
  ledgerId: string,
) {
  const ledgerParams = new URLSearchParams({
    select: "*",
    owner_id: `eq.${context.identity.userId}`,
    ledger_id: `eq.${ledgerId}`,
    limit: "1",
  });
  const ledgerRows = await requestStorage<SeoTitleLedgerRow[]>(
    context,
    `seo_title_ledgers?${ledgerParams.toString()}`,
  );
  const ledger = Array.isArray(ledgerRows) ? ledgerRows[0] ?? null : null;
  if (!ledger) return null;

  const statsParams = new URLSearchParams({
    select: "*",
    owner_id: `eq.${context.identity.userId}`,
    ledger_id: `eq.${ledgerId}`,
    limit: "1",
  });
  const statsRows = await requestStorage<SeoTitleLedgerStatsRow[]>(
    context,
    `seo_title_ledger_inventory_stats?${statsParams.toString()}`,
  );
  const inventoryParams = new URLSearchParams({
    select:
      "title_id,owner_id,ledger_id,product_group,title,title_fingerprint,semantic_fingerprint,generation_batch,quality_score,source_materials,status,reservation_id,reservation_expires_at,dispatch_id,mall_key,goods_key,metadata,created_at,updated_at",
    owner_id: `eq.${context.identity.userId}`,
    ledger_id: `eq.${ledgerId}`,
    order: "product_group.asc,quality_score.desc,created_at.asc",
    limit: "1000",
  });
  const inventory = await requestStorage<SeoTitleInventoryRow[]>(
    context,
    `seo_title_inventory?${inventoryParams.toString()}`,
  );
  return {
    ledger,
    stats: Array.isArray(statsRows) ? statsRows[0] ?? null : null,
    inventory: Array.isArray(inventory) ? inventory : [],
  };
}

export async function findSeoTitleLedgerByKey(
  context: SeoTitleLedgerContext,
  ledgerKey: string,
) {
  const params = new URLSearchParams({
    select: "*",
    owner_id: `eq.${context.identity.userId}`,
    ledger_key: `eq.${ledgerKey}`,
    limit: "1",
  });
  const rows = await requestStorage<SeoTitleLedgerRow[]>(
    context,
    `seo_title_ledgers?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function upsertSeoTitleLedger(
  context: SeoTitleLedgerContext,
  row: Record<string, unknown>,
) {
  const params = new URLSearchParams({ on_conflict: "owner_id,ledger_key" });
  const rows = await requestStorage<SeoTitleLedgerRow[]>(
    context,
    `seo_title_ledgers?${params.toString()}`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ ...row, owner_id: context.identity.userId }),
    },
  );
  const saved = Array.isArray(rows) ? rows[0] ?? null : null;
  if (!saved) throw new Error("SEO 상품명 원장을 저장하지 못했습니다.");
  return saved;
}

export async function listSeoTitleInventoryFingerprints(
  context: SeoTitleLedgerContext,
  ledgerId: string,
) {
  const params = new URLSearchParams({
    select: "title_fingerprint,semantic_fingerprint,product_group,generation_batch,status",
    owner_id: `eq.${context.identity.userId}`,
    ledger_id: `eq.${ledgerId}`,
    limit: "5000",
  });
  const rows = await requestStorage<
    Array<{
      title_fingerprint: string;
      semantic_fingerprint: string;
      product_group: string;
      generation_batch: number;
      status: string;
    }>
  >(context, `seo_title_inventory?${params.toString()}`);
  return Array.isArray(rows) ? rows : [];
}

export async function insertSeoTitleInventory(
  context: SeoTitleLedgerContext,
  rows: Array<Record<string, unknown>>,
) {
  if (!rows.length) return [];
  const result: SeoTitleInventoryRow[] = [];
  const chunkSize = 250;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize).map((row) => ({
      ...row,
      owner_id: context.identity.userId,
    }));
    const inserted = await requestStorage<SeoTitleInventoryRow[]>(
      context,
      "seo_title_inventory?on_conflict=ledger_id,title_fingerprint",
      {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(chunk),
      },
    );
    if (Array.isArray(inserted)) result.push(...inserted);
  }
  return result;
}

export async function patchSeoTitleLedger(
  context: SeoTitleLedgerContext,
  ledgerId: string,
  patch: Record<string, unknown>,
) {
  const params = new URLSearchParams({
    owner_id: `eq.${context.identity.userId}`,
    ledger_id: `eq.${ledgerId}`,
  });
  const rows = await requestStorage<SeoTitleLedgerRow[]>(
    context,
    `seo_title_ledgers?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function readProductLaunchItemForSeo(
  context: SeoTitleLedgerContext,
  launchItemId: string,
) {
  if (!launchItemId) return null;
  const params = new URLSearchParams({
    select:
      "item_id,tracker_row_number,model_number,product_name,item_payload,updated_at",
    owner_id: `eq.${context.identity.userId}`,
    item_id: `eq.${launchItemId}`,
    limit: "1",
  });
  const rows = await requestStorage<Array<Record<string, unknown>>>(
    context,
    `product_launch_items?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function insertSeoTitleDispatch(
  context: SeoTitleLedgerContext,
  row: Record<string, unknown>,
) {
  const rows = await requestStorage<Array<Record<string, unknown>>(
    context,
    "seo_title_dispatches",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...row, owner_id: context.identity.userId }),
    },
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function insertSeoTitleDispatchItems(
  context: SeoTitleLedgerContext,
  rows: Array<Record<string, unknown>>,
) {
  if (!rows.length) return [];
  return requestStorage<Array<Record<string, unknown>>(
    context,
    "seo_title_dispatch_items",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(
        rows.map((row) => ({ ...row, owner_id: context.identity.userId })),
      ),
    },
  );
}

export async function listSeoTitleDispatches(
  context: SeoTitleLedgerContext,
  options: { ledgerId?: string; limit?: number } = {},
) {
  const params = new URLSearchParams({
    select: "*",
    owner_id: `eq.${context.identity.userId}`,
    order: "created_at.desc",
    limit: String(Math.max(1, Math.min(200, Math.trunc(options.limit ?? 50)))),
  });
  if (options.ledgerId) params.set("ledger_id", `eq.${options.ledgerId}`);
  const rows = await requestStorage<Array<Record<string, unknown>>(
    context,
    `seo_title_dispatches?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows : [];
}

export async function readSeoTitleDispatchItems(
  context: SeoTitleLedgerContext,
  dispatchId: string,
) {
  const params = new URLSearchParams({
    select: "*",
    owner_id: `eq.${context.identity.userId}`,
    dispatch_id: `eq.${dispatchId}`,
    order: "product_group.asc,created_at.asc",
    limit: "1500",
  });
  const rows = await requestStorage<Array<Record<string, unknown>>(
    context,
    `seo_title_dispatch_items?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows : [];
}

export async function patchSeoTitleDispatch(
  context: SeoTitleLedgerContext,
  dispatchId: string,
  patch: Record<string, unknown>,
) {
  const params = new URLSearchParams({
    owner_id: `eq.${context.identity.userId}`,
    dispatch_id: `eq.${dispatchId}`,
  });
  const rows = await requestStorage<Array<Record<string, unknown>>(
    context,
    `seo_title_dispatches?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function patchSeoTitleDispatchItems(
  context: SeoTitleLedgerContext,
  dispatchId: string,
  patch: Record<string, unknown>,
) {
  const params = new URLSearchParams({
    owner_id: `eq.${context.identity.userId}`,
    dispatch_id: `eq.${dispatchId}`,
  });
  return requestStorage<Array<Record<string, unknown>>(
    context,
    `seo_title_dispatch_items?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
}
