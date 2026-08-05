import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONFIRM_VALUE = "apply-final-2-approved-barcodes";

const ASSIGNMENTS = [
  {
    id: "launch-2374-aaa434",
    modelNumber: "AAA434",
    productName: "브래지어 세탁망 색상랜덤",
    warehouseLocation: "BBH6-1",
    barcode: "BBH6-1",
  },
  {
    id: "launch-2397-aaa442",
    modelNumber: "AAA442",
    productName: "세탁기원형받침대 4P세트",
    warehouseLocation: "BEG1-1",
    barcode: "BEG1-1",
  },
] as const;

type TrackerItem = Record<string, unknown> & {
  id?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  warehouseLocation?: unknown;
  barcode?: unknown;
  archivedAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: unknown;
};

type TrackerState = Record<string, unknown> & {
  items?: unknown;
  savedAt?: unknown;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== CONFIRM_VALUE) {
    return Response.json(
      {
        ok: false,
        code: "CONFIRMATION_REQUIRED",
        message: "최종 2건 기준바코드 반영 확인값이 필요합니다.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const origin = url.origin;
  const stateUrl = new URL("/api/product-launch-tracker/state", origin);
  const sameOriginHeaders = {
    Accept: "application/json",
    Origin: origin,
    Referer: `${origin}/product-launch-tracker`,
    "Sec-Fetch-Site": "same-origin",
  };

  const readResponse = await fetch(stateUrl, {
    method: "GET",
    headers: sameOriginHeaders,
    cache: "no-store",
  });
  const readBody = await readJson(readResponse);
  if (!readResponse.ok || !isRecord(readBody) || readBody.ok !== true) {
    return Response.json(
      {
        ok: false,
        code: "TRACKER_STATE_READ_FAILED",
        message: readErrorMessage(readBody, readResponse.status),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const state = isRecord(readBody.state)
    ? (structuredClone(readBody.state) as TrackerState)
    : null;
  const items = Array.isArray(state?.items)
    ? (state.items as TrackerItem[])
    : null;
  if (!state || !items) {
    return Response.json(
      {
        ok: false,
        code: "TRACKER_STATE_ITEMS_MISSING",
        message: "상품출시관리 저장본에 items 목록이 없습니다.",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = new Date().toISOString();
  const updated: Array<Record<string, unknown>> = [];
  const unchanged: Array<Record<string, unknown>> = [];
  const rejected: Array<Record<string, unknown>> = [];

  for (const assignment of ASSIGNMENTS) {
    const index = items.findIndex(
      (item) => safeText(item.id) === assignment.id,
    );
    if (index < 0) {
      rejected.push({ ...assignment, reason: "TARGET_ID_NOT_FOUND" });
      continue;
    }

    const item = items[index];
    const identityMatches =
      normalizeModelNumber(item.modelNumber) ===
        normalizeModelNumber(assignment.modelNumber) &&
      normalizeProductName(item.productName) ===
        normalizeProductName(assignment.productName) &&
      normalizeBarcode(item.warehouseLocation) ===
        normalizeBarcode(assignment.warehouseLocation) &&
      !safeText(item.archivedAt);
    if (!identityMatches) {
      rejected.push({
        ...assignment,
        reason: "TARGET_IDENTITY_MISMATCH",
        actual: {
          modelNumber: safeText(item.modelNumber),
          productName: safeText(item.productName),
          warehouseLocation: safeText(item.warehouseLocation),
          archivedAt: safeText(item.archivedAt),
        },
      });
      continue;
    }

    const expectedBarcode = normalizeBarcode(assignment.barcode);
    const currentBarcode = normalizeBarcode(item.barcode);
    if (currentBarcode === expectedBarcode) {
      unchanged.push({ ...assignment, before: currentBarcode, after: expectedBarcode });
      continue;
    }
    if (currentBarcode) {
      rejected.push({
        ...assignment,
        reason: "TARGET_ALREADY_HAS_DIFFERENT_BARCODE",
        currentBarcode,
      });
      continue;
    }

    const existingOwner = items.find(
      (candidate, candidateIndex) =>
        candidateIndex !== index &&
        !safeText(candidate.archivedAt) &&
        normalizeBarcode(candidate.barcode) === expectedBarcode,
    );
    if (existingOwner) {
      rejected.push({
        ...assignment,
        reason: "BARCODE_ALREADY_OWNED",
        currentOwner: {
          id: safeText(existingOwner.id),
          modelNumber: safeText(existingOwner.modelNumber),
          productName: safeText(existingOwner.productName),
        },
      });
      continue;
    }

    items[index] = {
      ...item,
      barcode: expectedBarcode,
      updatedAt: now,
      updatedBy: "승준",
    };
    updated.push({ ...assignment, before: currentBarcode, after: expectedBarcode });
  }

  if (rejected.length > 0) {
    return Response.json(
      {
        ok: false,
        code: "FINAL_BARCODE_VALIDATION_FAILED",
        requested: ASSIGNMENTS.length,
        updatedCount: 0,
        unchangedCount: unchanged.length,
        rejectedCount: rejected.length,
        unchanged,
        rejected,
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (updated.length > 0) {
    state.items = items;
    state.savedAt = now;
    const writeResponse = await fetch(stateUrl, {
      method: "PUT",
      headers: {
        ...sameOriginHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state }),
      cache: "no-store",
    });
    const writeBody = await readJson(writeResponse);
    if (!writeResponse.ok || !isRecord(writeBody) || writeBody.ok !== true) {
      return Response.json(
        {
          ok: false,
          code: "TRACKER_STATE_WRITE_FAILED",
          message: readErrorMessage(writeBody, writeResponse.status),
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  return Response.json(
    {
      ok: true,
      requested: ASSIGNMENTS.length,
      updatedCount: updated.length,
      unchangedCount: unchanged.length,
      rejectedCount: 0,
      updated,
      unchanged,
      appliedAt: now,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function normalizeModelNumber(value: unknown) {
  return safeText(value).toLowerCase();
}

function normalizeProductName(value: unknown) {
  return safeText(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeBarcode(value: unknown) {
  return safeText(value).replace(/\s+/g, "").toUpperCase();
}

function safeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readErrorMessage(body: unknown, status: number) {
  if (isRecord(body) && typeof body.message === "string" && body.message.trim()) {
    return body.message.trim();
  }
  return `상품출시관리 저장 요청에 실패했습니다. status=${status}`;
}
