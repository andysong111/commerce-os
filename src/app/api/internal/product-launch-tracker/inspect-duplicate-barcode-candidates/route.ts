import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONFIRM_VALUE = "inspect-approved-barcode-duplicates";
const TARGETS = new Map([
  ["aaa434", "브래지어 세탁망 색상랜덤"],
  ["aaa442", "세탁기원형받침대 4P세트"],
]);

type TrackerItem = Record<string, unknown> & {
  id?: unknown;
  workBatch?: unknown;
  warehouseLocation?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  barcode?: unknown;
  archivedAt?: unknown;
  migrationReview?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  source?: unknown;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== CONFIRM_VALUE) {
    return Response.json(
      { ok: false, code: "CONFIRMATION_REQUIRED" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const origin = url.origin;
  const response = await fetch(new URL("/api/product-launch-tracker/state", origin), {
    headers: {
      Accept: "application/json",
      Origin: origin,
      Referer: `${origin}/product-launch-tracker`,
      "Sec-Fetch-Site": "same-origin",
    },
    cache: "no-store",
  });
  const body = await readJson(response);
  if (!response.ok || !isRecord(body) || body.ok !== true || !isRecord(body.state)) {
    return Response.json(
      {
        ok: false,
        code: "TRACKER_STATE_READ_FAILED",
        status: response.status,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const items = Array.isArray(body.state.items)
    ? (body.state.items as TrackerItem[])
    : [];
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const modelNumber = normalize(item.modelNumber);
      const expectedName = TARGETS.get(modelNumber);
      return expectedName && normalize(item.productName) === normalize(expectedName);
    })
    .map(({ item, index }) => ({
      index,
      id: text(item.id),
      workBatch: text(item.workBatch),
      warehouseLocation: text(item.warehouseLocation),
      modelNumber: text(item.modelNumber),
      productName: text(item.productName),
      barcode: text(item.barcode),
      archivedAt: text(item.archivedAt),
      migrationReview: Boolean(item.migrationReview),
      createdAt: text(item.createdAt),
      updatedAt: text(item.updatedAt),
      source: summarizeSource(item.source),
      previous: summarizeNeighbor(items[index - 1]),
      next: summarizeNeighbor(items[index + 1]),
    }));

  return Response.json(
    { ok: true, count: candidates.length, candidates },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function summarizeNeighbor(item: TrackerItem | undefined) {
  if (!item) return null;
  return {
    modelNumber: text(item.modelNumber),
    productName: text(item.productName),
    barcode: text(item.barcode),
    workBatch: text(item.workBatch),
  };
}

function summarizeSource(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    file: text(value.file),
    sheet: text(value.sheet),
    rows: Array.isArray(value.rows) ? value.rows : [],
    sheetRowRefs: Array.isArray(value.sheetRowRefs) ? value.sheetRowRefs : [],
  };
}

function normalize(value: unknown) {
  return text(value).replace(/\s+/g, " ").toLowerCase();
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJson(response: Response) {
  const textBody = await response.text();
  if (!textBody) return null;
  try {
    return JSON.parse(textBody);
  } catch {
    return textBody;
  }
}
