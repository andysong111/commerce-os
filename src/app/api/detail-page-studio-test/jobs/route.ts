import { NextRequest } from "next/server";
import {
  getDetailPageJobConfig,
  publicDetailPageJob,
  resolveDetailPageJobIdentity,
} from "@/lib/detailPageJobServer";
import {
  createDetailPageTestStudioJob,
  normalizeDetailPageTestStudioInput,
} from "@/lib/detailPageTestStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  let input;
  try {
    input = normalizeDetailPageTestStudioInput(await request.json());
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_TEST_INPUT_INVALID",
        message:
          error instanceof Error
            ? error.message
            : "상세페이지 테스트 입력값이 올바르지 않습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const job = await createDetailPageTestStudioJob({
      config: config.value,
      identity: identity.value,
      input,
    });
    return Response.json(
      {
        ok: true,
        job: publicDetailPageJob(job),
        reviewUrl: `/detail-page-ai-review?jobId=${encodeURIComponent(job.id)}&filter=active`,
        message:
          "상세페이지 스튜디오 테스트버전 작업을 AI 작업 검수 원장에 등록했습니다.",
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_TEST_JOB_CREATE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상세페이지 테스트 작업을 등록하지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
