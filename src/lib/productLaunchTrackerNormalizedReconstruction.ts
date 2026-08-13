import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchStorageJson,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

const STATE_TABLE = "product_launch_tracker_states";
const WORKSPACE_TABLE = "product_launch_workspaces";
const ITEM_TABLE = "product_launch_items";
const OPTION_TABLE = "product_launch_options";
const EXPECTED_ITEM_COUNT = 346;
const EXPECTED_OPTION_COUNT = 740;
const ITEM_CHUNK_SIZE = 20;
const OPTION_CHUNK_SIZE = 200;

type UnknownRecord = Record<string, unknown>;

export type ProductLaunchCanonicalMetadata = {
  updated_at?: unknown;
  schema_version?: unknown;
  owner_email?: unknown;
};

type WorkspaceRow = {
  schema_version?: unknown;
  policy?: unknown;
  source_imported_at?: unknown;
  meta_payload?: unknown;
  source_state_updated_at?: unknown;
  normalized_read_enabled?: unknown;
};

export async function readProductLaunchCanonicalMetadata(
  config: ProductLaunchAdminConfig,
  ownerId: string,
): Promise<ProductLaunchCanonicalMetadata | null> {
  const params = new URLSearchParams({
    select: "updated_at,schema_version,owner_email",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${STATE_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
    { attempts: 3, timeoutMs: 30_000, retryDelaysMs: [1_000, 2_000] },
  );
  return (Array.isArray(body) ? body[0] ?? null : null) as ProductLaunchCanonicalMetadata | null;
}

export async function reconstructProductLaunchStateFromNormalized(
  config: ProductLaunchAdminConfig,
  ownerId: string,
  canonicalUpdatedAt: unknown,
) {
  const workspace = await readWorkspace(config, ownerId);
  if (!workspace) throw new Error("PRODUCT_LAUNCH_NORMALIZED_WORKSPACE_NOT_FOUND");
  if (workspace.normalized_read_enabled !== true) {
    throw new Error("PRODUCT_LAUNCH_NORMALIZED_READ_DISABLED");
  }
  if (!sameTimestamp(workspace.source_state_updated_at, canonicalUpdatedAt)) {
    throw new Error(
      `PRODUCT_LAUNCH_NORMALIZED_STALE source=${text(workspace.source_state_updated_at)} canonical=${text(canonicalUpdatedAt)}`,
    );
  }

  const [itemRows, optionRows] = await Promise.all([
    readChunkedRows(
      config,
      ITEM_TABLE,
      ownerId,
      "item_id,tracker_row_number,warehouse_location,barcode,model_number,product_name,item_payload,updated_at,updated_by",
      "tracker_row_number.asc.nullslast,item_id.asc",
      ITEM_CHUNK_SIZE,
      1_000,
    ),
    readChunkedRows(
      config,
      OPTION_TABLE,
      ownerId,
      "item_id,option_id,option_index,option_name,sale_option,china_option,barcode,base_sale_price_krw,unit_cost_krw,source_order_item_id,option_payload,updated_at",
      "item_id.asc,option_index.asc,option_id.asc",
      OPTION_CHUNK_SIZE,
      5_000,
    ),
  ]);

  if (itemRows.length !== EXPECTED_ITEM_COUNT) {
    throw new Error(
      `PRODUCT_LAUNCH_NORMALIZED_ITEM_COUNT_MISMATCH expected=${EXPECTED_ITEM_COUNT} actual=${itemRows.length}`,
    );
  }
  if (optionRows.length !== EXPECTED_OPTION_COUNT) {
    throw new Error(
      `PRODUCT_LAUNCH_NORMALIZED_OPTION_COUNT_MISMATCH expected=${EXPECTED_OPTION_COUNT} actual=${optionRows.length}`,
    );
  }

  const optionsByItem = new Map<string, UnknownRecord[]>();
  for (const row of optionRows) {
    const itemId = text(row.item_id);
    const optionId = text(row.option_id);
    if (!itemId || !optionId) {
      throw new Error("PRODUCT_LAUNCH_NORMALIZED_OPTION_ID_MISSING");
    }
    const option = cloneRecord(row.option_payload);
    option.id = optionId;
    option.optionName = text(row.option_name) || text(option.optionName) || "옵션";
    option.saleOption = text(row.sale_option) || text(option.saleOption ?? option.value);
    option.chinaOption = text(row.china_option);
    option.barcode = text(row.barcode);
    option.baseSalePriceKrw = nonNegativeInteger(row.base_sale_price_krw);
    option.unitCostKrw = nonNegativeInteger(row.unit_cost_krw);
    const sourceOrderItemId = nullableText(row.source_order_item_id);
    if (sourceOrderItemId) option.sourceOrderItemId = sourceOrderItemId;
    const list = optionsByItem.get(itemId) ?? [];
    list.push(option);
    optionsByItem.set(itemId, list);
  }

  const seenItemIds = new Set<string>();
  const items = itemRows.map((row) => {
    const itemId = text(row.item_id);
    if (!itemId || seenItemIds.has(itemId)) {
      throw new Error(`PRODUCT_LAUNCH_NORMALIZED_ITEM_ID_INVALID:${itemId}`);
    }
    seenItemIds.add(itemId);
    const item = cloneRecord(row.item_payload);
    const orderOptions = optionsByItem.get(itemId) ?? [];
    item.id = itemId;
    if (!Number.isFinite(Number(item.trackerRowNumber))) {
      item.trackerRowNumber = integerOrNull(row.tracker_row_number);
    }
    item.warehouseLocation = text(row.warehouse_location);
    item.barcode = text(row.barcode);
    item.modelNumber = text(row.model_number) || text(item.modelNumber);
    item.productName = text(row.product_name) || text(item.productName);
    item.orderOptions = orderOptions;
    item.options = orderOptions
      .map((option) => text(option.saleOption ?? option.value))
      .filter(Boolean);
    item.updatedAt = text(item.updatedAt) || text(row.updated_at);
    item.updatedBy = text(item.updatedBy) || text(row.updated_by);
    return item;
  });

  const state = cloneRecord(workspace.meta_payload) as ProductLaunchTrackerState;
  delete (state as UnknownRecord).productLaunchListSnapshot;
  state.schemaVersion = Math.max(
    3,
    Math.floor(Number(workspace.schema_version) || Number(state.schemaVersion) || 3),
  );
  state.policy = isRecord(workspace.policy) ? cloneRecord(workspace.policy) : {};
  const sourceImportedAt = nullableText(workspace.source_imported_at);
  if (sourceImportedAt) state.sourceImportedAt = sourceImportedAt;
  state.items = items;

  return {
    state,
    report: {
      source: "normalized_reconstruction",
      itemCount: items.length,
      optionCount: optionRows.length,
      sourceStateUpdatedAt: text(workspace.source_state_updated_at),
      canonicalUpdatedAt: text(canonicalUpdatedAt),
      readEnabled: true,
    },
  };
}

async function readWorkspace(
  config: ProductLaunchAdminConfig,
  ownerId: string,
): Promise<WorkspaceRow | null> {
  const params = new URLSearchParams({
    select:
      "schema_version,policy,source_imported_at,meta_payload,source_state_updated_at,normalized_read_enabled",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${WORKSPACE_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
    { attempts: 3, timeoutMs: 30_000, retryDelaysMs: [1_000, 2_000] },
  );
  return (Array.isArray(body) ? body[0] ?? null : null) as WorkspaceRow | null;
}

async function readChunkedRows(
  config: ProductLaunchAdminConfig,
  table: string,
  ownerId: string,
  select: string,
  order: string,
  chunkSize: number,
  maximumRows: number,
) {
  const output: UnknownRecord[] = [];
  for (let offset = 0; offset < maximumRows; offset += chunkSize) {
    const params = new URLSearchParams({
      select,
      owner_id: `eq.${ownerId}`,
      order,
      limit: String(chunkSize),
      offset: String(offset),
    });
    const { body } = await readProductLaunchStorageJson(
      `${config.supabaseUrl}/rest/v1/${table}?${params.toString()}`,
      {
        headers: createSupabaseAdminHeaders(config.secretKey),
        cache: "no-store",
      },
      { attempts: 3, timeoutMs: 75_000, retryDelaysMs: [1_000, 3_000] },
    );
    const rows = Array.isArray(body) ? body.filter(isRecord) : [];
    output.push(...rows);
    if (rows.length < chunkSize) return output;
  }
  throw new Error(`PRODUCT_LAUNCH_NORMALIZED_ROW_LIMIT_EXCEEDED:${table}`);
}

function sameTimestamp(left: unknown, right: unknown) {
  const leftMs = Date.parse(text(left));
  const rightMs = Date.parse(text(right));
  return (
    Number.isFinite(leftMs) &&
    Number.isFinite(rightMs) &&
    Math.abs(leftMs - rightMs) < 1_000
  );
}

function integerOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function cloneRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? JSON.parse(JSON.stringify(value)) : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}
