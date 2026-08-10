import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  writeProductLaunchState,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

export const PURCHASE_PLAN_DRAFT_QUEUE_KEY = "purchasePlanDraftQueue";
const MAX_QUEUE_ENTRIES = 80;
const MAX_ITEMS_PER_ENTRY = 500;
const SOURCE_RUN_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;
const BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;

export type PurchasePlanDraftQueueItem = {
  barcode: string;
  modelNumber: string | null;
  productName: string;
  saleOption: string;
  chinaOption: string;
  supplierLink: string;
  quantity: number;
  unitCostKrw: number;
  reason: string;
};

export type PurchasePlanDraftQueueEntry = {
  sourceRunId: string;
  periodLabel: string;
  items: PurchasePlanDraftQueueItem[];
  fingerprint: string;
  status: "PENDING" | "IMPORTED";
  queuedAt: string;
  updatedAt: string;
  importedAt: string | null;
  batchId: number | null;
};

type QueueState = {
  version: 1;
  entries: Record<string, PurchasePlanDraftQueueEntry>;
};

type TrackerState = Record<string, unknown> & {
  schemaVersion?: unknown;
  items?: unknown;
  [PURCHASE_PLAN_DRAFT_QUEUE_KEY]?: unknown;
};

export function normalizePurchasePlanDraftInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("발주안 중계 요청 객체가 필요합니다.");
  }
  const raw = value as Record<string, unknown>;
  const sourceRunId = text(raw.sourceRunId);
  const periodLabel = text(raw.periodLabel).slice(0, 120);
  if (!SOURCE_RUN_PATTERN.test(sourceRunId)) {
    throw new Error("발주안 원본 번호가 올바르지 않습니다.");
  }
  if (!periodLabel) throw new Error("발주안 기간명이 필요합니다.");

  const sourceItems = Array.isArray(raw.items) ? raw.items : [];
  if (!sourceItems.length) throw new Error("중국 주문초안에 전달할 상품이 없습니다.");
  if (sourceItems.length > MAX_ITEMS_PER_ENTRY) {
    throw new Error(`한 번에 최대 ${MAX_ITEMS_PER_ENTRY}개 상품까지 전달할 수 있습니다.`);
  }

  const byBarcode = new Map<string, PurchasePlanDraftQueueItem>();
  sourceItems.forEach((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${index + 1}행 상품 형식을 확인하세요.`);
    }
    const item = value as Record<string, unknown>;
    const barcode = text(item.barcode).normalize("NFKC").toUpperCase();
    const quantity = Number(item.quantity);
    const productName = text(item.productName).slice(0, 240);
    if (!BARCODE_PATTERN.test(barcode)) {
      throw new Error(`${index + 1}행 바코드는 BAA1-1 형식이어야 합니다.`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`${barcode}의 주문수량은 1 이상의 정수여야 합니다.`);
    }
    if (!productName) throw new Error(`${barcode}의 상품명이 비어 있습니다.`);
    byBarcode.set(barcode, {
      barcode,
      modelNumber: text(item.modelNumber).slice(0, 80) || null,
      productName,
      saleOption: text(item.saleOption).slice(0, 160),
      chinaOption: text(item.chinaOption).slice(0, 240),
      supplierLink: normalizeSupplierLink(item.supplierLink),
      quantity,
      unitCostKrw: Math.max(0, Math.round(Number(item.unitCostKrw) || 0)),
      reason: text(item.reason).slice(0, 300),
    });
  });
  const items = [...byBarcode.values()].sort((left, right) =>
    left.barcode.localeCompare(right.barcode),
  );
  return { sourceRunId, periodLabel, items };
}

export async function enqueuePurchasePlanDraft(value: unknown) {
  const input = normalizePurchasePlanDraftInput(value);
  const { config, identity, state, queue } = await readQueueContext();
  const now = new Date().toISOString();
  const existing = queue.entries[input.sourceRunId];
  const items = mergeItems(existing?.items ?? [], input.items);
  if (items.length > MAX_ITEMS_PER_ENTRY) {
    throw new Error(`한 발주안에는 최대 ${MAX_ITEMS_PER_ENTRY}개 상품까지 저장할 수 있습니다.`);
  }
  const fingerprint = JSON.stringify(items);

  if (existing?.status === "IMPORTED" && existing.fingerprint === fingerprint) {
    return { entry: existing, alreadyImported: true, alreadyQueued: false };
  }
  if (existing?.status === "PENDING" && existing.fingerprint === fingerprint) {
    return { entry: existing, alreadyImported: false, alreadyQueued: true };
  }

  const entry: PurchasePlanDraftQueueEntry = {
    sourceRunId: input.sourceRunId,
    periodLabel: input.periodLabel,
    items,
    fingerprint,
    status: "PENDING",
    queuedAt: existing?.queuedAt ?? now,
    updatedAt: now,
    importedAt: null,
    batchId: existing?.batchId ?? null,
  };
  queue.entries[input.sourceRunId] = entry;
  pruneQueue(queue);
  await writeQueue(config, identity, state, queue);
  return { entry, alreadyImported: false, alreadyQueued: false };
}

export async function readPendingPurchasePlanDrafts(sourceRunId?: string | null) {
  const { queue } = await readQueueContext();
  const requested = text(sourceRunId);
  return Object.values(queue.entries)
    .filter((entry) => entry.status === "PENDING")
    .filter((entry) => !requested || entry.sourceRunId === requested)
    .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
    .slice(0, 20);
}

export async function acknowledgePurchasePlanDraft(input: {
  sourceRunId: string;
  batchId: number;
}) {
  const { config, identity, state, queue } = await readQueueContext();
  const sourceRunId = text(input.sourceRunId);
  const batchId = Math.trunc(Number(input.batchId));
  const entry = queue.entries[sourceRunId];
  if (!entry) throw new Error("확인 처리할 발주안 중계 항목이 없습니다.");
  if (!(batchId > 0)) throw new Error("중국 발주차시 번호를 확인하세요.");

  const now = new Date().toISOString();
  const next: PurchasePlanDraftQueueEntry = {
    ...entry,
    status: "IMPORTED",
    importedAt: now,
    updatedAt: now,
    batchId,
  };
  queue.entries[sourceRunId] = next;
  await writeQueue(config, identity, state, queue);
  return next;
}

function mergeItems(
  existing: PurchasePlanDraftQueueItem[],
  incoming: PurchasePlanDraftQueueItem[],
) {
  const byBarcode = new Map<string, PurchasePlanDraftQueueItem>();
  existing.forEach((item) => byBarcode.set(item.barcode, item));
  incoming.forEach((item) => byBarcode.set(item.barcode, item));
  return [...byBarcode.values()].sort((left, right) =>
    left.barcode.localeCompare(right.barcode),
  );
}

async function readQueueContext() {
  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) throw new Error(configResult.body.message);
  const identity = temporaryOpsIdentity();
  const stored = await readProductLaunchState(configResult.value, identity.userId);
  const state = normalizeTrackerState(stored?.state_payload);
  const queue = normalizeQueue(state[PURCHASE_PLAN_DRAFT_QUEUE_KEY]);
  return { config: configResult.value, identity, state, queue };
}

async function writeQueue(
  config: ProductLaunchAdminConfig,
  identity: ProductLaunchIdentity,
  state: TrackerState,
  queue: QueueState,
) {
  await writeProductLaunchState(config, identity, {
    ...state,
    schemaVersion: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)),
    [PURCHASE_PLAN_DRAFT_QUEUE_KEY]: queue,
  });
}

function normalizeTrackerState(value: unknown): TrackerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { schemaVersion: 3, items: [] };
  }
  const state = structuredClone(value) as TrackerState;
  if (!Array.isArray(state.items)) state.items = [];
  return state;
}

function normalizeQueue(value: unknown): QueueState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { version: 1, entries: {} };
  }
  const raw = value as Partial<QueueState>;
  const entries =
    raw.entries && typeof raw.entries === "object" && !Array.isArray(raw.entries)
      ? (structuredClone(raw.entries) as Record<string, PurchasePlanDraftQueueEntry>)
      : {};
  return { version: 1, entries };
}

function pruneQueue(queue: QueueState) {
  const rows = Object.values(queue.entries).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const keep = rows.slice(0, MAX_QUEUE_ENTRIES);
  queue.entries = Object.fromEntries(keep.map((entry) => [entry.sourceRunId, entry]));
}

function normalizeSupplierLink(value: unknown) {
  const candidate = text(value);
  if (!candidate) return "";
  if (candidate.length > 4000) throw new Error("중국 주문링크는 4,000자 이하로 입력하세요.");
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("INVALID_PROTOCOL");
    return url.toString();
  } catch {
    throw new Error("중국 주문링크는 올바른 http/https 주소여야 합니다.");
  }
}

function text(value: unknown) {
  return String(value ?? "").trim();
}
