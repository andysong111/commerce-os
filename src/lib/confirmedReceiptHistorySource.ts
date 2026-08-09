const DEFAULT_CHINA_ORDER_BASE_URL =
  "https://china-order-manager.andy123df23.chatgpt.site";
const MAX_PAGES = 10;
const PAGE_LIMIT = 5000;
const SOURCE_MODES = new Set([
  "immutable_inventory_movement",
  "legacy_confirmed_batch",
]);

export type ConfirmedReceiptHistoryRow = {
  id: string;
  receiptId: string;
  batchId: number;
  orderItemId: number;
  barcode: string;
  modelNumber: string;
  optionName: string;
  quantity: number;
  unitCostKrw: number;
  receivedAt: string;
};

export type ConfirmedReceiptHistorySource = {
  sourceMode: "immutable_inventory_movement" | "legacy_confirmed_batch";
  syncedAt: string;
  pageCount: number;
  sourceWritesEnabled: false;
  filter: null;
  rows: ConfirmedReceiptHistoryRow[];
};

type SourcePayload = {
  ok?: boolean;
  receipts?: unknown;
  nextSince?: unknown;
  hasMore?: unknown;
  syncedAt?: unknown;
  sourceMode?: unknown;
  sourceWritesEnabled?: unknown;
  filter?: unknown;
  code?: unknown;
  message?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeRow(value: unknown): ConfirmedReceiptHistoryRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  const receiptId = text(row.receiptId);
  const batchId = positiveInteger(row.batchId);
  const orderItemId = positiveInteger(row.orderItemId);
  const barcode = text(row.barcode).toUpperCase().replace(/\s+/g, "");
  const quantity = positiveNumber(row.quantity);
  const unitCostKrw = Math.ceil(positiveNumber(row.unitCostKrw));
  const receivedAt = iso(row.receivedAt);
  if (
    !id ||
    !receiptId ||
    !batchId ||
    !orderItemId ||
    !barcode ||
    !quantity ||
    !unitCostKrw ||
    !receivedAt
  ) {
    return null;
  }
  return {
    id,
    receiptId,
    batchId,
    orderItemId,
    barcode,
    modelNumber: text(row.modelNumber),
    optionName: text(row.optionName),
    quantity,
    unitCostKrw,
    receivedAt,
  };
}

function connection() {
  const secrets = [
    process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET,
    process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET,
    process.env.PRODUCT_MASTER_INTEGRATION_SECRET,
  ]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
  const baseUrl = (
    process.env.CHINA_ORDER_MANAGER_BASE_URL?.trim() ||
    DEFAULT_CHINA_ORDER_BASE_URL
  ).replace(/\/$/, "");
  if (!secrets.length) throw new Error("CHINA_RECEIPT_INTEGRATION_SECRET_REQUIRED");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("CHINA_ORDER_MANAGER_BASE_URL_INVALID");
  }
  return { secrets, baseUrl };
}

async function fetchPage(input: {
  baseUrl: string;
  secret: string;
  since?: string;
}) {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (input.since) params.set("since", input.since);
  const response = await fetch(
    `${input.baseUrl}/api/integrations/price-adjustment-receipts?${params.toString()}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.secret}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as SourcePayload;
  return { response, payload };
}

async function readWithSecret(input: {
  baseUrl: string;
  secret: string;
}): Promise<ConfirmedReceiptHistorySource> {
  const rows = new Map<string, ConfirmedReceiptHistoryRow>();
  let since = "";
  let sourceMode: ConfirmedReceiptHistorySource["sourceMode"] | null = null;
  let syncedAt = "";

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { response, payload } = await fetchPage({
      ...input,
      since: since || undefined,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(`CHINA_RECEIPT_HISTORY_AUTH:${response.status}`);
    }
    if (!response.ok || payload.ok !== true) {
      throw new Error(
        `CHINA_RECEIPT_HISTORY_FAILED:${response.status}:${text(payload.code || payload.message)}`,
      );
    }
    if (payload.sourceWritesEnabled !== false) {
      throw new Error("CHINA_RECEIPT_HISTORY_WRITE_CONTRACT_INVALID");
    }
    if (payload.filter !== null && payload.filter !== undefined) {
      throw new Error("CHINA_RECEIPT_HISTORY_UNEXPECTED_FILTER");
    }
    const mode = text(payload.sourceMode);
    if (!SOURCE_MODES.has(mode)) {
      throw new Error(`CHINA_RECEIPT_HISTORY_SOURCE_MODE_INVALID:${mode}`);
    }
    if (sourceMode && sourceMode !== mode) {
      throw new Error("CHINA_RECEIPT_HISTORY_SOURCE_MODE_CHANGED_DURING_PAGING");
    }
    sourceMode = mode as ConfirmedReceiptHistorySource["sourceMode"];
    syncedAt = iso(payload.syncedAt) || syncedAt || new Date().toISOString();

    const rawRows = Array.isArray(payload.receipts) ? payload.receipts : [];
    for (const raw of rawRows) {
      const row = normalizeRow(raw);
      if (!row) throw new Error("CHINA_RECEIPT_HISTORY_ROW_INVALID");
      rows.set(row.id, row);
    }

    const hasMore = payload.hasMore === true;
    const nextSince = text(payload.nextSince);
    if (!hasMore) {
      return {
        sourceMode: sourceMode!,
        syncedAt,
        pageCount: page,
        sourceWritesEnabled: false,
        filter: null,
        rows: [...rows.values()].sort(
          (left, right) =>
            Date.parse(left.receivedAt) - Date.parse(right.receivedAt) ||
            left.id.localeCompare(right.id),
        ),
      };
    }
    if (!nextSince || nextSince === since) {
      throw new Error("CHINA_RECEIPT_HISTORY_CURSOR_INVALID");
    }
    since = nextSince;
  }
  throw new Error("CHINA_RECEIPT_HISTORY_PAGE_LIMIT_EXCEEDED");
}

export async function loadConfirmedReceiptHistorySource(): Promise<ConfirmedReceiptHistorySource> {
  const { secrets, baseUrl } = connection();
  let lastAuthError: Error | null = null;
  for (const secret of secrets) {
    try {
      return await readWithSecret({ baseUrl, secret });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("CHINA_RECEIPT_HISTORY_AUTH:")) {
        lastAuthError = error instanceof Error ? error : new Error(message);
        continue;
      }
      throw error;
    }
  }
  throw lastAuthError ?? new Error("CHINA_RECEIPT_HISTORY_AUTH_FAILED");
}
