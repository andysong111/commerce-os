import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const JOB_TABLE = "product_launch_upload_jobs";

type UnknownRecord = Record<string, unknown>;
type Config = { supabaseUrl: string; secretKey: string };

export type HistoricalShoplingOptionRecovery = {
  options: Array<{
    id: string;
    optionName: string;
    saleOption: string;
    chinaOption: string;
    barcode: string;
    optionBarcodeNo: string;
    baseSalePriceKrw: number;
    unitCostKrw: number;
    sourceOrderItemId: null;
  }>;
  evidence: {
    source: "successful_shopling_upload_job";
    sourceJobId: string;
    sourceRequestId: string;
    sourceCompletedAt: string;
    baseChannelKey: string;
    optionCount: number;
  };
};

export async function recoverProductLaunchOrderOptionsFromSuccessfulUpload(
  config: Config,
  launchItemId: string,
  policyInput: unknown,
): Promise<HistoricalShoplingOptionRecovery | null> {
  const itemId = text(launchItemId);
  if (!itemId) return null;

  const params = new URLSearchParams({
    select: "id,request_id,payload,completed_at,created_at",
    launch_item_id: `eq.${itemId}`,
    status: "eq.success",
    order: "completed_at.desc,created_at.desc",
    limit: "20",
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${JOB_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const raw = await response.text();
  let body: unknown = [];
  try {
    body = raw ? JSON.parse(raw) : [];
  } catch {
    body = [];
  }
  if (!response.ok) {
    throw new Error(
      `과거 Shopling 등록 옵션을 읽지 못했습니다. status=${response.status}`,
    );
  }

  for (const value of Array.isArray(body) ? body : []) {
    const row = record(value);
    const recovered = recoverProductLaunchOrderOptionsFromPayload(
      row.payload,
      policyInput,
    );
    if (!recovered) continue;
    return {
      options: recovered.options,
      evidence: {
        source: "successful_shopling_upload_job",
        sourceJobId: text(row.id),
        sourceRequestId: text(row.request_id),
        sourceCompletedAt: text(row.completed_at) || text(row.created_at),
        baseChannelKey: recovered.baseChannelKey,
        optionCount: recovered.options.length,
      },
    };
  }
  return null;
}

export function recoverProductLaunchOrderOptionsFromPayload(
  payloadInput: unknown,
  policyInput: unknown,
) {
  const payload = record(payloadInput);
  const policy = record(policyInput);
  const multipliers = record(policy.channelMultipliers);
  const channels = array(payload.channels).map(record);
  if (!channels.length) return null;

  const baseChannel = channels.find((channel) => {
    const key = text(channel.key);
    const multiplier = Number(multipliers[key]);
    return key && Number.isFinite(multiplier) && Math.abs(multiplier - 1) < 1e-9;
  });
  if (!baseChannel) return null;

  const baseChannelKey = text(baseChannel.key);
  const options = array(baseChannel.options).flatMap((value, index) => {
    const option = record(value);
    const barcode = normalizeCode(option.barcode);
    const optionBarcodeNo = text(option.optionBarcodeNo).replace(/^OB/i, "");
    const baseSalePriceKrw = positiveInteger(option.finalSalePriceKrw);
    const saleOption = text(option.saleOption);
    if (
      !barcode ||
      !saleOption ||
      !/^\d{12}$/.test(optionBarcodeNo) ||
      baseSalePriceKrw <= 0
    ) {
      return [];
    }
    return [
      {
        id: `shopling-history-${index + 1}-${barcode}`,
        optionName: text(option.optionName) || "옵션",
        saleOption,
        chinaOption: "",
        barcode,
        optionBarcodeNo,
        baseSalePriceKrw,
        // Shopling upload pricing does not consume unit cost. Keep unknown cost as 0
        // instead of fabricating a purchase cost from a selling price.
        unitCostKrw: 0,
        sourceOrderItemId: null,
      },
    ];
  });
  if (!options.length) return null;
  if (new Set(options.map((option) => option.barcode)).size !== options.length) {
    return null;
  }
  if (
    new Set(options.map((option) => option.optionBarcodeNo)).size !== options.length
  ) {
    return null;
  }
  return { baseChannelKey, options };
}

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

function normalizeCode(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, "");
}

function positiveInteger(value: unknown) {
  const number = Math.ceil(Number(value) || 0);
  return number > 0 ? number : 0;
}
