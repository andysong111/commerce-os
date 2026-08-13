import { NextRequest } from "next/server";
import { loadFreshProductLaunchNormalized } from "@/lib/productLaunchTrackerNormalizedAvailability";
import {
  queryProductLaunchNormalizedPage,
  readProductLaunchNormalizedItem,
  readProductLaunchNormalizedItems,
} from "@/lib/productLaunchTrackerNormalizedStore";
import {
  disableProductLaunchNormalizedRead,
  syncProductLaunchNormalizedAfterMutation,
} from "@/lib/productLaunchTrackerNormalizedWriteBridge";
import { GET as legacyGet, PATCH as legacyPatch } from "../optimized/route";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") || "page";
  if (!new Set(["page", "item", "items"]).has(mode)) return legacyGet(request);

  const loaded = await loadFreshProductLaunchNormalized(request);
  if (loaded.response) return loaded.response;
  if (!loaded.value) return legacyGet(request);

  const { config, identity, workspace, updatedAt, schemaVersion } = loaded.value;

  try {
    if (mode === "page") {
      const page = await queryProductLaunchNormalizedPage(
        config,
        identity.userId,
        workspace,
        {
          page: request.nextUrl.searchParams.get("page"),
          pageSize: request.nextUrl.searchParams.get("pageSize"),
          search: request.nextUrl.searchParams.get("search"),
          batch: request.nextUrl.searchParams.get("batch"),
          assignee: request.nextUrl.searchParams.get("assignee"),
          overall: request.nextUrl.searchParams.get("overall"),
          unfinishedOnly: request.nextUrl.searchParams.get("unfinishedOnly"),
          sort: request.nextUrl.searchParams.get("sort"),
          direction: request.nextUrl.searchParams.get("direction"),
        },
      );

      return Response.json({
        ok: true,
        stateExists: true,
        ...page,
        policy: isRecord(workspace.policy) ? workspace.policy : null,
        sourceImportedAt: nullableText(workspace.source_imported_at),
        updatedAt,
        schemaVersion,
        listSource: "normalized",
      });
    }

    if (mode === "item") {
      const itemId = request.nextUrl.searchParams.get("id")?.trim() || "";
      if (!itemId) {
        return Response.json(
          {
            ok: false,
            code: "PRODUCT_LAUNCH_TRACKER_ITEM_ID_REQUIRED",
            message: "불러올 상품 ID가 필요합니다.",
          },
          { status: 400 },
        );
      }

      const item = await readProductLaunchNormalizedItem(
        config,
        identity.userId,
        itemId,
      );
      if (!item) {
        return Response.json(
          {
            ok: false,
            code: "PRODUCT_LAUNCH_TRACKER_ITEM_NOT_FOUND",
            message: "상품 기록을 찾지 못했습니다.",
          },
          { status: 404 },
        );
      }

      return Response.json({
        ok: true,
        stateExists: true,
        item,
        policy: isRecord(workspace.policy) ? workspace.policy : null,
        updatedAt,
        schemaVersion,
        itemSource: "normalized",
      });
    }

    const requestedIds = readRequestedIds(request);
    if (!requestedIds.length) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_TRACKER_ITEM_IDS_REQUIRED",
          message: "불러올 상품 ID가 필요합니다.",
        },
        { status: 400 },
      );
    }
    if (requestedIds.length > 100) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_TRACKER_ITEM_LIMIT_EXCEEDED",
          message: "한 번에 최대 100개 상품까지 불러올 수 있습니다.",
        },
        { status: 400 },
      );
    }

    const items = await readProductLaunchNormalizedItems(
      config,
      identity.userId,
      requestedIds,
    );
    const foundIds = new Set(
      items.map((item) => text(asRecord(item).id)).filter(Boolean),
    );
    const missingIds = requestedIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_TRACKER_ITEMS_NOT_FOUND",
          message: "일부 상품 기록을 찾지 못했습니다. 목록을 새로고침한 뒤 다시 선택하세요.",
          missingIds,
        },
        { status: 404 },
      );
    }

    return Response.json({
      ok: true,
      stateExists: true,
      items,
      updatedAt,
      schemaVersion,
      itemSource: "normalized",
    });
  } catch (error) {
    console.error("[product-launch-normalized-read] detailed read fallback", error);
    return legacyGet(request);
  }
}

export async function PATCH(request: NextRequest) {
  const inputPromise = request.clone().json().catch(() => null as unknown);
  const response = await legacyPatch(request);
  if (!response.ok) return response;

  const input = await inputPromise;
  const payload = await response.clone().json().catch(() => null as unknown);
  try {
    await syncProductLaunchNormalizedAfterMutation(request, input, payload);
  } catch (error) {
    console.error("[product-launch-normalized-write] legacy write kept", error);
    await disableProductLaunchNormalizedRead(request);
  }
  return response;
}

function readRequestedIds(request: NextRequest) {
  return [
    ...new Set(
      request.nextUrl.searchParams
        .getAll("id")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
