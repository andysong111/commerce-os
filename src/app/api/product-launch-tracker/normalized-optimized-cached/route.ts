import { NextRequest } from "next/server";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import {
  getProductLaunchAdminConfig,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  queryProductLaunchNormalizedPage,
  readProductLaunchNormalizedWorkspace,
} from "@/lib/productLaunchTrackerNormalizedStore";
import { GET as legacyGet, PATCH as legacyPatch } from "../normalized-optimized/route";

const CACHE_TAG_PREFIX = "product-launch-page";

type PageQuery = {
  page: string | null;
  pageSize: string | null;
  search: string | null;
  batch: string | null;
  assignee: string | null;
  overall: string | null;
  unfinishedOnly: string | null;
  sort: string | null;
  direction: string | null;
};

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") || "page";
  if (mode !== "page") return legacyGet(request);

  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  try {
    const body = await readCachedPage(
      identity.value.userId,
      JSON.stringify(readPageQuery(request)),
    );
    if (!body) return legacyGet(request);
    return Response.json(
      { ...body, listCache: "vercel-runtime-cache" },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Commerce-List-Cache": "remote",
        },
      },
    );
  } catch (error) {
    console.error("[product-launch-page-cache] read failed", error);
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_LIST_TEMPORARILY_UNAVAILABLE",
        message:
          "상품 목록 저장소가 일시적으로 혼잡합니다. 잠시 후 자동으로 다시 불러옵니다.",
      },
      {
        status: 503,
        headers: {
          "Retry-After": "5",
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  const response = await legacyPatch(request);
  if (response.ok && identity.ok) {
    revalidateTag(cacheTagFor(identity.value.userId));
  }
  return response;
}

async function readCachedPage(ownerId: string, queryJson: string) {
  "use cache: remote";
  cacheLife({ stale: 30, revalidate: 10, expire: 300 });
  cacheTag(cacheTagFor(ownerId));

  const config = getProductLaunchAdminConfig();
  if (!config.ok) throw new Error("상품출시진행관리 저장소 설정을 읽지 못했습니다.");

  const workspace = await readProductLaunchNormalizedWorkspace(config.value, ownerId);
  if (!workspace || workspace.normalized_read_enabled !== true) return null;

  const query = JSON.parse(queryJson) as PageQuery;
  const page = await queryProductLaunchNormalizedPage(
    config.value,
    ownerId,
    workspace,
    query,
  );

  return {
    ok: true,
    stateExists: true,
    ...page,
    policy: isRecord(workspace.policy) ? workspace.policy : null,
    sourceImportedAt: nullableText(workspace.source_imported_at),
    updatedAt:
      nullableText(workspace.source_state_updated_at) ??
      nullableText(workspace.updated_at),
    schemaVersion: numberOrNull(workspace.schema_version),
    listSource: "normalized",
  };
}

function readPageQuery(request: NextRequest): PageQuery {
  return {
    page: request.nextUrl.searchParams.get("page"),
    pageSize: request.nextUrl.searchParams.get("pageSize"),
    search: request.nextUrl.searchParams.get("search"),
    batch: request.nextUrl.searchParams.get("batch"),
    assignee: request.nextUrl.searchParams.get("assignee"),
    overall: request.nextUrl.searchParams.get("overall"),
    unfinishedOnly: request.nextUrl.searchParams.get("unfinishedOnly"),
    sort: request.nextUrl.searchParams.get("sort"),
    direction: request.nextUrl.searchParams.get("direction"),
  };
}

function cacheTagFor(ownerId: string) {
  return `${CACHE_TAG_PREFIX}:${ownerId}`;
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function numberOrNull(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
