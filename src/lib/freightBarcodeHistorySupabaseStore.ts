import {
  buildFreightBarcodeHistoryRecordFromCurrentState,
} from "./freightBarcodeHistory.ts";
import {
  createSupabaseAdminHeaders,
} from "./supabase/admin.ts";
import type {
  CreateFreightBarcodeHistoryRecordInput,
  FreightBarcodeHistoryStorageAdapter,
  UpdateFreightBarcodeHistoryRecordInput,
} from "./freightBarcodeHistoryStorage.ts";
import type {
  FreightApplicationItem,
  FreightBarcodeHistoryRecord,
  FreightBarcodeHistorySource,
  FreightBarcodeProductMasterMatch,
} from "../types/freightBarcodeRequest.ts";

const TABLE_NAME = "freight_barcode_history";

type SupabaseConfig = {
  baseUrl: string;
  secretKey: string;
};

type FreightBarcodeHistoryRow = {
  id: string;
  application_no: string;
  title: string;
  raw_text: string;
  parsed_items: unknown;
  product_master_matches: unknown;
  memo: string;
  created_at: string;
  updated_at: string;
  source: string;
  pdf_version: number;
  item_count: number;
  matched_item_count: number;
};

function getSupabaseConfig(): SupabaseConfig | undefined {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();

  if (!baseUrl || !secretKey) return undefined;
  return { baseUrl, secretKey };
}

function isHistorySource(value: string): value is FreightBarcodeHistorySource {
  return value === "manual-paste" || value === "restored-history";
}

function cloneItems(value: unknown): FreightApplicationItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is FreightApplicationItem => Boolean(item && typeof item === "object"))
    .map((item) => ({ ...item }));
}

function cloneMatches(value: unknown): FreightBarcodeProductMasterMatch[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((match): match is FreightBarcodeProductMasterMatch =>
      Boolean(match && typeof match === "object" && "itemId" in match),
    )
    .map((match) => ({ ...match }));
}

function rowToRecord(row: FreightBarcodeHistoryRow): FreightBarcodeHistoryRecord {
  const parsedItems = cloneItems(row.parsed_items);
  const source = isHistorySource(row.source) ? row.source : "manual-paste";
  const baseRecord = buildFreightBarcodeHistoryRecordFromCurrentState({
    id: row.id,
    applicationNo: row.application_no,
    title: row.title,
    rawText: row.raw_text,
    items: parsedItems,
    memo: row.memo,
    source,
    now: row.updated_at,
  });
  const productMasterMatches = cloneMatches(row.product_master_matches);
  const pdfVersion = Number.isFinite(row.pdf_version)
    ? row.pdf_version
    : baseRecord.pdfVersion;

  return {
    ...baseRecord,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    productMasterMatches:
      productMasterMatches.length > 0
        ? productMasterMatches
        : baseRecord.productMasterMatches,
    pdfVersion,
    version: pdfVersion,
    itemCount: Number.isFinite(row.item_count)
      ? row.item_count
      : parsedItems.length,
    matchedItemCount: Number.isFinite(row.matched_item_count)
      ? row.matched_item_count
      : productMasterMatches.length,
    parsedItems,
    items: parsedItems,
  };
}

function recordToRow(record: FreightBarcodeHistoryRecord): FreightBarcodeHistoryRow {
  return {
    id: record.id,
    application_no: record.applicationNo,
    title: record.title,
    raw_text: record.rawText,
    parsed_items: record.parsedItems,
    product_master_matches: record.productMasterMatches,
    memo: record.memo,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    source: record.source,
    pdf_version: record.pdfVersion,
    item_count: record.itemCount,
    matched_item_count: record.matchedItemCount,
  };
}

function createRequestUrl(baseUrl: string, params?: URLSearchParams): string {
  const query = params?.toString();
  return `${baseUrl}/rest/v1/${TABLE_NAME}${query ? `?${query}` : ""}`;
}

async function readRows(response: Response): Promise<FreightBarcodeHistoryRow[]> {
  const text = await response.text();
  let body: unknown = [];
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Supabase freight history request failed. status=${response.status}`;
    throw new Error(message);
  }

  return Array.isArray(body) ? (body as FreightBarcodeHistoryRow[]) : [];
}

export class SupabaseFreightBarcodeHistoryStorage
  implements FreightBarcodeHistoryStorageAdapter
{
  constructor(private readonly config: SupabaseConfig) {}

  async create(
    input: CreateFreightBarcodeHistoryRecordInput,
  ): Promise<FreightBarcodeHistoryRecord> {
    const record = buildFreightBarcodeHistoryRecordFromCurrentState(input);
    const response = await fetch(createRequestUrl(this.config.baseUrl), {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(this.config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify(recordToRow(record)),
      cache: "no-store",
    });
    const rows = await readRows(response);
    return rows[0] ? rowToRecord(rows[0]) : record;
  }

  async list(): Promise<FreightBarcodeHistoryRecord[]> {
    const params = new URLSearchParams({
      select: "*",
      order: "updated_at.desc",
      limit: "500",
    });
    const response = await fetch(createRequestUrl(this.config.baseUrl, params), {
      headers: createSupabaseAdminHeaders(this.config.secretKey),
      cache: "no-store",
    });
    const rows = await readRows(response);
    return rows.map(rowToRecord);
  }

  async get(id: string): Promise<FreightBarcodeHistoryRecord | undefined> {
    const params = new URLSearchParams({ select: "*", id: `eq.${id}`, limit: "1" });
    const response = await fetch(createRequestUrl(this.config.baseUrl, params), {
      headers: createSupabaseAdminHeaders(this.config.secretKey),
      cache: "no-store",
    });
    const rows = await readRows(response);
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }

  async update(
    id: string,
    input: UpdateFreightBarcodeHistoryRecordInput,
  ): Promise<FreightBarcodeHistoryRecord | undefined> {
    const params = new URLSearchParams({ id: `eq.${id}` });
    const response = await fetch(createRequestUrl(this.config.baseUrl, params), {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(this.config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.memo !== undefined ? { memo: input.memo.trim() } : {}),
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    });
    const rows = await readRows(response);
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const params = new URLSearchParams({ id: `eq.${id}` });
    const response = await fetch(createRequestUrl(this.config.baseUrl, params), {
      method: "DELETE",
      headers: {
        ...createSupabaseAdminHeaders(this.config.secretKey),
        Prefer: "return=representation",
      },
      cache: "no-store",
    });
    const rows = await readRows(response);
    return rows.length > 0;
  }
}

export function createSupabaseFreightBarcodeHistoryStorage():
  | SupabaseFreightBarcodeHistoryStorage
  | undefined {
  const config = getSupabaseConfig();
  return config ? new SupabaseFreightBarcodeHistoryStorage(config) : undefined;
}
