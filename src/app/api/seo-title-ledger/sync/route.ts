import { NextRequest } from "next/server";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import { syncSeoTitleBulkInventoryForItem } from "@/lib/seoTitleBulkInventorySync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function uniqueItemIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(text)
        .filter((itemId) => itemId && itemId.length <= 160),
    ),
  ].slice(0, 50);
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>,
) {
  let cursor = 0;
  const result: R[] = [];
  async function runner() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await worker(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => runner()),
  );
  return result;
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const body = await request.json().catch(() => ({}));
  const itemIds = uniqueItemIds(
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).itemIds
      : [],
  );
  if (!itemIds.length) {
    return Response.json(
      {
        ok: false,
        code: "SEO_TITLE_SYNC_ITEM_IDS_REQUIRED",
        message: "동기화할 상품 ID가 필요합니다.",
      },
      { status: 400 },
    );
  }

  const context = authenticated.value;
  const results = await mapLimit(itemIds, 2, async (itemId) => {
    try {
      return await syncSeoTitleBulkInventoryForItem(context, itemId);
    } catch (error) {
      return {
        itemId,
        synced: false,
        reason: error instanceof Error ? error.message : "상품명 재고 동기화 실패",
      };
    }
  });
  return Response.json({
    ok: true,
    requestedCount: itemIds.length,
    syncedCount: results.filter((row) => row.synced).length,
    skippedCount: results.filter((row) => !row.synced).length,
    results,
  });
}
