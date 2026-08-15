import { NextRequest } from "next/server";
import { revalidateTag, unstable_cache } from "next/cache";
import {
  getDetailPageJobConfig,
  listDetailPageJobs,
  publicDetailPageJob,
  resolveDetailPageJobIdentity,
  searchDetailPageJobs,
} from "@/lib/detailPageJobServer";
import { POST as legacyPost } from "../detail-page-jobs/route";

const MAX_RECENT_JOBS = 50;
const CACHE_TAG_PREFIX = "detail-page-jobs";
const JOB_LIST_REVALIDATE_SECONDS = 15;

export async function GET(request: NextRequest) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  try {
    const jobs = await readCachedJobs(identity.value.userId, query);
    return Response.json(
      {
        ok: true,
        scope: query ? "search" : "recent",
        jobs: jobs.map(publicDetailPageJob),
        listSource: "next-data-cache",
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Commerce-Job-Cache": "data-cache",
        },
      },
    );
  } catch (error) {
    console.error("[detail-page-job-list-cache] read failed", error);
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_JOB_LIST_TEMPORARILY_UNAVAILABLE",
        message:
          "상세페이지 작업 저장소가 일시적으로 혼잡합니다. 기존 작업은 계속 진행되며 잠시 후 상태가 갱신됩니다.",
      },
      {
        status: 503,
        headers: {
          "Retry-After": "10",
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
}

export async function POST(request: NextRequest) {
  const identity = await resolveDetailPageJobIdentity(request);
  const response = await legacyPost(request);
  if (response.ok && identity.ok) {
    revalidateTag(cacheTagFor(identity.value.userId), "max");
  }
  return response;
}

function readCachedJobs(ownerId: string, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  return unstable_cache(
    async () => {
      const config = getDetailPageJobConfig();
      if (!config.ok) {
        throw new Error("상세페이지 작업 저장소 설정을 읽지 못했습니다.");
      }
      return normalizedQuery
        ? searchDetailPageJobs(
            config.value,
            ownerId,
            normalizedQuery,
            MAX_RECENT_JOBS,
          )
        : listDetailPageJobs(config.value, ownerId, MAX_RECENT_JOBS);
    },
    ["detail-page-job-list-v2", ownerId, normalizedQuery],
    {
      revalidate: JOB_LIST_REVALIDATE_SECONDS,
      tags: [cacheTagFor(ownerId)],
    },
  )();
}

function cacheTagFor(ownerId: string) {
  return `${CACHE_TAG_PREFIX}:${ownerId}`;
}
