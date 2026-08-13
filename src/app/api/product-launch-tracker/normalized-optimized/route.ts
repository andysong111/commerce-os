import { NextRequest } from "next/server";
import { loadFreshProductLaunchNormalized } from "@/lib/productLaunchTrackerNormalizedAvailability";
import { queryProductLaunchNormalizedPage } from "@/lib/productLaunchTrackerNormalizedStore";
import {
  disableProductLaunchNormalizedRead,
  syncProductLaunchNormalizedAfterMutation,
} from "@/lib/productLaunchTrackerNormalizedWriteBridge";
import { GET as legacyGet, PATCH as legacyPatch } from "../optimized/route";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") || "page";
  if (mode !== "page") return legacyGet(request);

  const loaded = await loadFreshProductLaunchNormalized(request);
  if (loaded.response) return loaded.response;
  if (!loaded.value) return legacyGet(request);

  const { config, identity, workspace, updatedAt, schemaVersion } = loaded.value;
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

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
