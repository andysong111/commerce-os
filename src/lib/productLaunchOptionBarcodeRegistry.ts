import { createHash } from "node:crypto";

import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

type UnknownRecord = Record<string, unknown>;
type Config = { supabaseUrl: string; secretKey: string };

type OptionBarcodeIdentity = {
  identityKey: string;
  identityKind: "B_CODE" | "OPTION" | "SET";
  primaryBCode: string;
  composition: Array<{ bCode: string; option: string; quantity: number }>;
};

export function normalizeOptionBCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function canonicalizeOptionSetComposition(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const bCode = normalizeOptionBCode(
        row.bCode ?? row.barcode ?? row.locationCode ?? row.location_code,
      );
      const option = text(row.option ?? row.optionName ?? row.saleOption);
      const quantity = Math.max(1, Math.floor(Number(row.quantity ?? row.qty ?? 1) || 1));
      return { bCode, option, quantity };
    })
    .filter((entry) => entry.bCode)
    .sort((left, right) =>
      `${left.bCode}|${left.option}|${left.quantity}`.localeCompare(
        `${right.bCode}|${right.option}|${right.quantity}`,
        "ko",
      ),
    );
}

export function buildOptionBarcodeIdentity(input: {
  ownerId: string;
  itemId: string;
  optionId: string;
  option: unknown;
}): OptionBarcodeIdentity {
  const option = asRecord(input.option);
  const existingIdentityKey = text(option.optionBarcodeIdentityKey);
  const composition = canonicalizeOptionSetComposition(
    option.setComposition ?? option.bundleComposition ?? option.composition,
  );

  if (composition.length) {
    const canonical = JSON.stringify(composition);
    const digest = createHash("sha256")
      .update(canonical)
      .digest("hex")
      .slice(0, 32)
      .toUpperCase();
    return {
      identityKey: `SET:${digest}`,
      identityKind: "SET",
      primaryBCode: normalizeOptionBCode(option.barcode),
      composition,
    };
  }

  if (existingIdentityKey.startsWith("SET:")) {
    return {
      identityKey: existingIdentityKey,
      identityKind: "SET",
      primaryBCode: normalizeOptionBCode(option.barcode),
      composition,
    };
  }

  const bCode = normalizeOptionBCode(option.barcode);
  if (bCode) {
    return {
      identityKey: `B:${bCode}`,
      identityKind: "B_CODE",
      primaryBCode: bCode,
      composition: [],
    };
  }

  return {
    identityKey: `OPTION:${input.ownerId}:${input.itemId}:${input.optionId}`,
    identityKind: "OPTION",
    primaryBCode: "",
    composition: [],
  };
}

export async function attachOptionBarcodeNosToChangedItems(
  config: Config,
  ownerId: string,
  stateInput: ProductLaunchTrackerState,
  changedIdsInput: string[],
) {
  const changedIds = new Set(changedIdsInput.map(text).filter(Boolean));
  if (!changedIds.size) return stateInput;

  const state = structuredClone(stateInput) as ProductLaunchTrackerState;
  const items = Array.isArray(state.items) ? state.items.map(asRecord) : [];
  const requests = new Map<string, OptionBarcodeIdentity>();
  const bindings: Array<{
    item: UnknownRecord;
    option: UnknownRecord;
    identity: OptionBarcodeIdentity;
  }> = [];

  for (const item of items) {
    const itemId = text(item.id);
    if (!changedIds.has(itemId)) continue;
    const options = Array.isArray(item.orderOptions)
      ? item.orderOptions.map(asRecord)
      : [];
    options.forEach((option, index) => {
      const optionId = text(option.id) || `option-${index + 1}`;
      option.id = optionId;
      const identity = buildOptionBarcodeIdentity({
        ownerId,
        itemId,
        optionId,
        option,
      });
      requests.set(identity.identityKey, identity);
      bindings.push({ item, option, identity });
    });
    item.orderOptions = options;
  }

  if (!requests.size) {
    state.items = items;
    return state;
  }

  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/rpc/resolve_option_barcode_nos`,
    {
      method: "POST",
      headers: createRegistryAdminHeaders(config.secretKey),
      body: JSON.stringify({ p_requests: [...requests.values()] }),
      cache: "no-store",
    },
  );
  const body = (await response.json().catch(() => [])) as unknown;
  if (!response.ok || !Array.isArray(body)) {
    throw new Error(
      `옵션바코드NO 원장 발급에 실패했습니다. status=${response.status}`,
    );
  }

  const resolved = new Map<string, string>();
  for (const row of body) {
    const record = asRecord(row);
    const identityKey = text(record.identity_key ?? record.identityKey);
    const optionBarcodeNo = text(record.option_barcode_no ?? record.optionBarcodeNo);
    if (identityKey && /^OB\d{12}$/.test(optionBarcodeNo)) {
      resolved.set(identityKey, optionBarcodeNo);
    }
  }

  for (const binding of bindings) {
    const optionBarcodeNo = resolved.get(binding.identity.identityKey);
    if (!optionBarcodeNo) {
      throw new Error(
        `옵션바코드NO를 확인하지 못했습니다: ${binding.identity.identityKey}`,
      );
    }
    binding.option.optionBarcodeNo = optionBarcodeNo;
    binding.option.optionBarcodeIdentityKey = binding.identity.identityKey;
    binding.option.optionBarcodeIdentityKind = binding.identity.identityKind;
  }

  for (const item of items) {
    if (!changedIds.has(text(item.id))) continue;
    const options = Array.isArray(item.orderOptions)
      ? item.orderOptions.map(asRecord)
      : [];
    item.optionBarcodeNos = options
      .map((option) => text(option.optionBarcodeNo))
      .filter(Boolean);
  }

  state.items = items;
  return state;
}

function createRegistryAdminHeaders(secretKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: secretKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (!secretKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${secretKey}`;
  }
  return headers;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}
