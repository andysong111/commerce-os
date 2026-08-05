import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONFIRM_VALUE = "apply-32-approved-barcodes";

const ASSIGNMENTS = [
  { modelNumber: "aaa425", productName: "해골 펜거치대", barcode: "BCG8-2" },
  { modelNumber: "aaa421", productName: "5단 고수압 샤워기", barcode: "BBA6-2" },
  { modelNumber: "aaa430", productName: "해골 키링", barcode: "BCG8-1" },
  { modelNumber: "aaa220", productName: "늘어나는 대형샤워볼80g 색상랜덤", barcode: "BBE6-1" },
  { modelNumber: "aaa434", productName: "브래지어 세탁망 색상랜덤", barcode: "BBH6-1" },
  { modelNumber: "aaa452", productName: "반자동 책갈피 3p 색상랜덤", barcode: "BCB7-1" },
  { modelNumber: "aaa454", productName: "메모리폼 다리쿠션 그레이", barcode: "BCB5-1" },
  { modelNumber: "aaa360", productName: "흡착형 샤워기거치대 실버그레이", barcode: "BCG8-3" },
  { modelNumber: "aaa439", productName: "잘라쓰는 뒤꿈치 롱패드1쌍", barcode: "BCA8-1" },
  { modelNumber: "aaa437", productName: "붙이는 서랍레일 1쌍", barcode: "BCG3-1" },
  { modelNumber: "aaa480", productName: "재사용 EVA 우비 140g", barcode: "BEF1-1" },
  { modelNumber: "aaa447", productName: "계란노른자섞기 스피너", barcode: "BEH1-1" },
  { modelNumber: "aaa442", productName: "세탁기원형받침대 4P세트", barcode: "BEG1-1" },
  { modelNumber: "aaa488", productName: "실리콘 땅콩 골프공커버", barcode: "BEH4-1" },
  { modelNumber: "aaa486", productName: "실리콘 미세세안브러쉬 색상랜덤", barcode: "BEH3-2" },
  { modelNumber: "aaa487", productName: "소프트 실리콘 두피브러쉬", barcode: "BEH3-1" },
  { modelNumber: "aaa485", productName: "길이조절 등드름브러쉬 색상랜덤", barcode: "BEG4-1" },
  { modelNumber: "aaa470", productName: "304스텐 욕실청소건 실버", barcode: "BEG5-2" },
  { modelNumber: "aaa469", productName: "304스텐 욕실청소건 블랙", barcode: "BEG5-1" },
  { modelNumber: "aaa466", productName: "쿨넥밴드 색상랜덤", barcode: "BED3-1" },
  { modelNumber: "aaa468", productName: "키보드 주차번호판", barcode: "BEH5-3" },
  { modelNumber: "aaa461", productName: "3단 우산형건조대 화이트", barcode: "BAB6-3" },
  { modelNumber: "aaa481", productName: "스트라이프 버킷햇", barcode: "BEH2-1" },
  { modelNumber: "aaa482", productName: "밀짚 스티치버킷햇", barcode: "BEG6-1" },
  { modelNumber: "aaa459", productName: "공기주입기 게이지형 색상랜덤", barcode: "BEE3-3" },
  { modelNumber: "aaa460", productName: "공기주입기 펌프 색상랜덤", barcode: "BEE3-2" },
  { modelNumber: "aaa478", productName: "차량용 자석거치대", barcode: "BEG3-1" },
  { modelNumber: "aaa448", productName: "책상정리 미니서랍 화이트", barcode: "BED4-1" },
  { modelNumber: "aaa449", productName: "투명 굿즈서랍 수납함", barcode: "BEE4-1" },
  { modelNumber: "aaa446", productName: "볼펜꽂이 미니 가죽노트", barcode: "BEC1-1" },
  { modelNumber: "aaa484", productName: "크루아상 쿠션", barcode: "BAC6-2" },
  { modelNumber: "aaa479", productName: "헤드레스트 스웨이드 후크", barcode: "BEF6-1" },
] as const;

type TrackerItem = Record<string, unknown> & {
  modelNumber?: unknown;
  productName?: unknown;
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
        message: "승인된 기준바코드 반영 확인값이 필요합니다.",
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
  const unmatched: Array<Record<string, unknown>> = [];
  const conflicts: Array<Record<string, unknown>> = [];

  for (const assignment of ASSIGNMENTS) {
    const exactMatches = items
      .map((item, index) => ({ item, index }))
      .filter(
        (entry) =>
          normalizeModelNumber(entry.item.modelNumber) ===
            normalizeModelNumber(assignment.modelNumber) &&
          normalizeProductName(entry.item.productName) ===
            normalizeProductName(assignment.productName),
      );
    const activeMatches = exactMatches.filter(
      (entry) => !safeText(entry.item.archivedAt),
    );
    const candidates = activeMatches.length ? activeMatches : exactMatches;

    if (candidates.length !== 1) {
      unmatched.push({
        ...assignment,
        exactMatchCount: exactMatches.length,
        activeMatchCount: activeMatches.length,
      });
      continue;
    }

    const target = candidates[0];
    const barcodeOwner = items
      .map((item, index) => ({ item, index }))
      .find(
        (entry) =>
          entry.index !== target.index &&
          !safeText(entry.item.archivedAt) &&
          normalizeBarcode(entry.item.barcode) ===
            normalizeBarcode(assignment.barcode),
      );
    if (barcodeOwner) {
      conflicts.push({
        ...assignment,
        currentOwnerModelNumber: safeText(barcodeOwner.item.modelNumber),
        currentOwnerProductName: safeText(barcodeOwner.item.productName),
      });
      continue;
    }

    const before = normalizeBarcode(target.item.barcode);
    const after = normalizeBarcode(assignment.barcode);
    if (before === after) {
      unchanged.push({ ...assignment, before, after });
      continue;
    }

    items[target.index] = {
      ...target.item,
      barcode: after,
      updatedAt: now,
      updatedBy: "승준",
    };
    updated.push({ ...assignment, before, after });
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
          requested: ASSIGNMENTS.length,
          updated,
          unchanged,
          unmatched,
          conflicts,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  return Response.json(
    {
      ok: unmatched.length === 0 && conflicts.length === 0,
      requested: ASSIGNMENTS.length,
      updatedCount: updated.length,
      unchangedCount: unchanged.length,
      unmatchedCount: unmatched.length,
      conflictCount: conflicts.length,
      updated,
      unchanged,
      unmatched,
      conflicts,
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
