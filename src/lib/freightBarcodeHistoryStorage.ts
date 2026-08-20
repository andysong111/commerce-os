import type {
  BuildFreightBarcodeHistoryRecordInput,
} from "./freightBarcodeHistory.ts";
import {
  InMemoryFreightBarcodeHistoryStorage,
} from "./freightBarcodeHistoryStore.ts";
import {
  createSupabaseFreightBarcodeHistoryStorage,
} from "./freightBarcodeHistorySupabaseStore.ts";
import type {
  FreightBarcodeHistoryRecord,
} from "../types/freightBarcodeRequest.ts";

export type CreateFreightBarcodeHistoryRecordInput = Omit<
  BuildFreightBarcodeHistoryRecordInput,
  "existingRecord" | "id" | "now"
>;

export interface UpdateFreightBarcodeHistoryRecordInput {
  title?: string;
  memo?: string;
}

/**
 * Server-side storage contract for Freight Barcode PDF history.
 *
 * Implementations must return detached records so callers cannot mutate stored
 * state. The asynchronous contract lets production use durable storage while
 * local/test environments can keep the lightweight in-memory adapter.
 */
export interface FreightBarcodeHistoryStorageAdapter {
  create(
    input: CreateFreightBarcodeHistoryRecordInput,
  ): Promise<FreightBarcodeHistoryRecord>;
  list(): Promise<FreightBarcodeHistoryRecord[]>;
  get(id: string): Promise<FreightBarcodeHistoryRecord | undefined>;
  update(
    id: string,
    input: UpdateFreightBarcodeHistoryRecordInput,
  ): Promise<FreightBarcodeHistoryRecord | undefined>;
  delete(id: string): Promise<boolean>;
}

const globalStorage = globalThis as typeof globalThis & {
  __commerceOsFreightBarcodeHistoryStorage?: FreightBarcodeHistoryStorageAdapter;
  __commerceOsFreightBarcodeSupabaseHistoryStorage?: FreightBarcodeHistoryStorageAdapter;
};

function getMemoryStorage(): FreightBarcodeHistoryStorageAdapter {
  globalStorage.__commerceOsFreightBarcodeHistoryStorage ??=
    new InMemoryFreightBarcodeHistoryStorage();
  return globalStorage.__commerceOsFreightBarcodeHistoryStorage;
}

function getSupabaseStorage(): FreightBarcodeHistoryStorageAdapter | undefined {
  if (globalStorage.__commerceOsFreightBarcodeSupabaseHistoryStorage) {
    return globalStorage.__commerceOsFreightBarcodeSupabaseHistoryStorage;
  }

  const storage = createSupabaseFreightBarcodeHistoryStorage();
  if (!storage) return undefined;
  globalStorage.__commerceOsFreightBarcodeSupabaseHistoryStorage = storage;
  return storage;
}

/**
 * Production defaults to Supabase whenever the existing Ops Center Supabase
 * credentials are available. Explicit `memory` keeps local/test workflows
 * isolated, and missing credentials safely fall back to memory.
 */
export function getFreightBarcodeHistoryStorage(): FreightBarcodeHistoryStorageAdapter {
  const mode = process.env.FREIGHT_BARCODE_HISTORY_STORAGE?.trim().toLowerCase();

  if (mode === "memory") return getMemoryStorage();
  if (mode === undefined || mode === "" || mode === "supabase") {
    return getSupabaseStorage() ?? getMemoryStorage();
  }

  return getMemoryStorage();
}
