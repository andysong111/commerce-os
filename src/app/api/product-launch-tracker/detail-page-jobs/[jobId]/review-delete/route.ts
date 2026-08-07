import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  DETAIL_PAGE_JOB_TABLE,
  getDetailPageJobConfig,
  isValidDetailPageJobId,
  readDetailPageJob,
  resolveDetailPageJobIdentity,
} from "@/lib/detailPageJobServer";

const DELETABLE_STATUSES = new Set(["cancelled", "failed", "success"]);

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const { jobId } = await context.params;
  if (!isValidDetailPageJobId(jobId)) {
    return Response.json(
      { ok: false, code: "INVALID_DETAIL_PAGE_JOB", message: "작업 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const job = await readDetailPageJob(config.value, jobId);
    if (!job || job.owner_id !== identity.value.userId) {
      return Response.json(
        { ok: false, code: "DETAIL_PAGE_JOB_NOT_FOUND", message: "상세페이지 작업을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    if (!DELETABLE_STATUSES.has(job.status)) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_JOB_DELETE_REQUIRES_STOP",
          message: "진행 중 작업은 먼저 취소한 뒤 삭제할 수 있습니다.",
        },
        { status: 409 },
      );
    }
    if (job.status === "success" && job.qa_status !== "passed") {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_JOB_COMPLETED_DELETE_NOT_ALLOWED",
          message: "최종 검수 통과 완료 작업만 완료 목록에서 삭제할 수 있습니다.",
        },
        { status: 409 },
      );
    }

    const params = new URLSearchParams({
      id: `eq.${job.id}`,
      owner_id: `eq.${identity.value.userId}`,
      "payload->>kind": "eq.detail_page",
    });
    const response = await fetch(
      `${config.value.supabaseUrl}/rest/v1/${DETAIL_PAGE_JOB_TABLE}?${params.toString()}`,
      {
        method: "DELETE",
        headers: {
          ...createSupabaseAdminHeaders(config.value.secretKey),
          Prefer: "return=representation",
        },
        cache: "no-store",
      },
    );
    const body = await response.text();
    if (!response.ok) {
      throw new Error(body || `상세페이지 작업 삭제에 실패했습니다. status=${response.status}`);
    }
    return Response.json({
      ok: true,
      deletedJobId: job.id,
      deletedStatus: job.status,
      preservedProductAssets: true,
      preservedStorageAssets: true,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_REVIEW_JOB_DELETE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상세페이지 작업을 삭제하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
