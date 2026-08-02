import { NextRequest } from "next/server";
import {
  bearerToken,
  getDetailPageJobConfig,
  isValidDetailPageJobId,
  patchDetailPageJob,
  publicDetailPageJob,
  readDetailPageJob,
  resolveDetailPageJobIdentity,
  verifyDetailPageJobToken,
} from "@/lib/detailPageJobServer";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

const TERMINAL = new Set(["success", "failed", "cancelled"]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });
  const { jobId } = await context.params;
  if (!isValidDetailPageJobId(jobId)) return invalid("작업 ID가 올바르지 않습니다.");
  try {
    const job = await readDetailPageJob(config.value, jobId);
    if (!job || job.owner_id !== identity.value.userId) return notFound();
    return Response.json({
      ok: true,
      job: publicDetailPageJob(job),
    });
  } catch (error) {
    return failed("DETAIL_PAGE_JOB_READ_FAILED", error, "상세페이지 작업을 읽지 못했습니다.");
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });
  const { jobId } = await context.params;
  if (!isValidDetailPageJobId(jobId)) return invalid("작업 ID가 올바르지 않습니다.");

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = asRecord(parsed);
  } catch {
    return invalid("작업 변경 JSON이 필요합니다.");
  }
  const action = String(body.action ?? "").trim();
  try {
    const job = await readDetailPageJob(config.value, jobId);
    if (!job) return notFound();
    const token = bearerToken(request);
    const workerAuthorized = Boolean(token) && verifyDetailPageJobToken(
      config.value,
      job.owner_id,
      job.id,
      token,
    );
    let ownerAuthorized = false;
    if (!workerAuthorized && isSameOriginOpsRequest(request)) {
      const identity = await resolveDetailPageJobIdentity(request);
      ownerAuthorized = identity.ok && identity.value.userId === job.owner_id;
    }
    if (!workerAuthorized && !ownerAuthorized) {
      return Response.json(
        { ok: false, code: "DETAIL_PAGE_JOB_AUTH_FAILED", message: "상세페이지 작업 인증에 실패했습니다." },
        { status: 401 },
      );
    }

    if (action === "claim") {
      if (!workerAuthorized) return forbidden("서버 작업자만 작업을 인계받을 수 있습니다.");
      if (TERMINAL.has(job.status) || job.status === "render_pending") {
        return Response.json({ ok: true, terminal: true, job: publicDetailPageJob(job) });
      }
      const now = Date.now();
      const leaseUntil = Date.parse(job.lease_until ?? "");
      const requestedWorker = safeText(body.workerId, 160);
      if (!requestedWorker) return invalid("workerId가 필요합니다.");
      if (Number.isFinite(leaseUntil) && leaseUntil > now && job.lease_owner && job.lease_owner !== requestedWorker) {
        return Response.json({ ok: true, busy: true, job: publicDetailPageJob(job) });
      }
      const claimed = await patchDetailPageJob(config.value, job.id, {
        status: job.status === "queued" ? "running" : job.status,
        lease_owner: requestedWorker,
        lease_until: new Date(now + 7 * 60 * 1000).toISOString(),
        started_at: job.started_at ?? new Date(now).toISOString(),
      });
      return Response.json({ ok: true, busy: false, job: publicDetailPageJob(claimed ?? job) });
    }

    if (action === "source_started") {
      if (!ownerAuthorized) return forbidden("OPS 화면만 수집 실행을 기록할 수 있습니다.");
      const sourceRunId = safeText(body.sourceRunId, 200);
      if (!sourceRunId) return invalid("1688 수집 run_id가 필요합니다.");
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: "collecting",
        stage: "source_collection",
        message: "1688 상품정보·이미지 수집 중",
        progress: 5,
        source_run_id: sourceRunId,
        error_message: "",
      });
      return Response.json({ ok: true, job: publicDetailPageJob(changed ?? job) });
    }

    if (action === "source_failed") {
      if (!ownerAuthorized) return forbidden("OPS 화면만 수집 실패를 기록할 수 있습니다.");
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: "failed",
        stage: safeText(body.stage, 100) || "source_collection",
        message: "1688 상품정보·이미지 수집에 실패했습니다.",
        qa_status: "failed",
        error_message: safeText(body.error, 2_000) || "1688 수집 실패",
        lease_owner: "",
        lease_until: null,
        completed_at: new Date().toISOString(),
      });
      return Response.json({ ok: true, job: publicDetailPageJob(changed ?? job) });
    }

    if (action === "resume_checkpointed_generation") {
      if (!ownerAuthorized) {
        return forbidden("OPS 화면만 실패한 서버 생성을 이어서 실행할 수 있습니다.");
      }
      const evidenceUrls = stringList(job.payload.evidence_urls, 60);
      const hasAnalysis = Boolean(asRecord(job.result.analysis).product);
      if (
        job.status !== "failed" ||
        job.stage !== "server_generation" ||
        !evidenceUrls.length ||
        !hasAnalysis
      ) {
        return Response.json(
          {
            ok: false,
            code: "DETAIL_PAGE_CHECKPOINT_NOT_RESUMABLE",
            message: "재사용할 수 있는 상세페이지 생성 체크포인트가 없습니다.",
          },
          { status: 409 },
        );
      }
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: "queued",
        stage: "checkpoint_resume",
        message: "기존 승인 자산 유지 · 실패 지점부터 이어서 생성 대기 중",
        progress: clamp(job.progress, 10, 92),
        qa_status: "pending",
        payload: {
          attempt: job.attempt + 1,
          assistant_hidden_at: "",
        },
        result: {
          setAssessment: null,
          representativeRetryRole: "",
          representativeRetryInstruction: "",
          setRetryUsed: false,
        },
        lease_owner: "",
        lease_until: null,
        error_message: "",
        completed_at: null,
      });
      return Response.json({ ok: true, job: publicDetailPageJob(changed ?? job) });
    }

    if (action === "evidence_ready") {
      if (!ownerAuthorized) return forbidden("OPS 화면만 수집 근거를 등록할 수 있습니다.");
      const evidenceUrls = stringList(body.evidenceUrls, 60);
      if (!evidenceUrls.length || evidenceUrls.some((url) => !isOwnedAssetUrl(url, config.value.supabaseUrl, job))) {
        return invalid("저장된 1688 근거 이미지 URL 구성이 올바르지 않습니다.");
      }
      const productName = safeText(body.productName, 250);
      if (!productName) return invalid("수집된 상품명이 필요합니다.");
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: "queued",
        stage: "queued",
        message: "서버 생성 대기 중 · 화면을 닫아도 계속됩니다.",
        progress: 10,
        qa_status: "pending",
        payload: {
          product_name: productName,
          source_product_info: safeText(body.sourceProductInfo, 8_000),
          evidence_urls: evidenceUrls,
          evidence_names: stringList(body.evidenceNames, 60).map((value) => safeText(value, 160)),
        },
        lease_owner: "",
        lease_until: null,
        error_message: "",
      });
      return Response.json({ ok: true, job: publicDetailPageJob(changed ?? job) });
    }

    if (["progress", "checkpoint", "render_pending", "failed"].includes(action)) {
      if (!workerAuthorized) return forbidden("Studio 서버 작업자만 생성 상태를 기록할 수 있습니다.");
      const result = asRecord(body.result);
      const nextStatus =
        action === "render_pending" ? "render_pending" : action === "failed" ? "failed" : "running";
      const releasesLease = action !== "progress";
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: nextStatus,
        stage: safeText(body.stage, 100) || job.stage,
        message: safeText(body.message, 500) || job.message,
        progress: clamp(Number(body.progress ?? job.progress), 0, action === "render_pending" ? 99 : 95),
        qa_status: action === "render_pending" ? "passed" : action === "failed" ? "failed" : job.qa_status,
        result,
        step_version: Math.max(job.step_version, Number(body.stepVersion) || job.step_version),
        lease_owner: releasesLease ? "" : job.lease_owner,
        lease_until: releasesLease ? null : job.lease_until,
        error_message: action === "failed" ? safeText(body.error, 2_000) || "상세페이지 서버 생성에 실패했습니다." : "",
        completed_at: action === "failed" ? new Date().toISOString() : null,
      });
      return Response.json({ ok: true, job: publicDetailPageJob(changed ?? job) });
    }

    if (action === "final_complete") {
      if (!ownerAuthorized) return forbidden("OPS 화면만 최종 도킹을 완료할 수 있습니다.");
      const detailImageUrl = safeText(body.detailImageUrl, 2_000);
      const mainImageUrl = safeText(body.mainImageUrl, 2_000);
      const additionalImageUrls = stringList(body.additionalImageUrls, 4);
      const urls = [detailImageUrl, mainImageUrl, ...additionalImageUrls];
      if (urls.length !== 6 || urls.some((url) => !isOwnedAssetUrl(url, config.value.supabaseUrl, job))) {
        return invalid("최종 상세·대표·부가 이미지 URL 구성이 올바르지 않습니다.");
      }
      const completedAt = new Date().toISOString();
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: "success",
        stage: "docked",
        message: "검수 통과 · 상세 HTML과 이미지 URL 자동 도킹 완료",
        progress: 100,
        qa_status: "passed",
        result: { detailImageUrl, mainImageUrl, additionalImageUrls },
        lease_owner: "",
        lease_until: null,
        error_message: "",
        completed_at: completedAt,
      });
      return Response.json({ ok: true, job: publicDetailPageJob(changed ?? job) });
    }

    if (action === "cancel") {
      if (!ownerAuthorized) return forbidden("OPS 화면만 작업을 취소할 수 있습니다.");
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: "cancelled",
        stage: "cancelled",
        message: "사용자가 작업을 취소했습니다.",
        qa_status: "failed",
        error_message: "사용자 취소",
        completed_at: new Date().toISOString(),
      });
      return Response.json({ ok: true, job: publicDetailPageJob(changed ?? job) });
    }

    if (action === "dismiss_failed_from_assistant") {
      if (!ownerAuthorized) {
        return forbidden("OPS 화면에서 본인의 실패 작업만 삭제할 수 있습니다.");
      }
      if (job.status !== "failed") {
        return Response.json(
          {
            ok: false,
            code: "DETAIL_PAGE_JOB_NOT_FAILED",
            message: "실패한 상세페이지 작업만 도우미에서 삭제할 수 있습니다.",
          },
          { status: 409 },
        );
      }
      const hiddenAt = new Date().toISOString();
      const changed = await patchDetailPageJob(config.value, job.id, {
        payload: { assistant_hidden_at: hiddenAt },
      });
      if (!changed) return notFound();
      return Response.json({
        ok: true,
        hiddenAt,
        job: publicDetailPageJob(changed),
      });
    }

    return invalid("지원하지 않는 작업 변경입니다.");
  } catch (error) {
    return failed("DETAIL_PAGE_JOB_UPDATE_FAILED", error, "상세페이지 작업 상태를 저장하지 못했습니다.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown, max: number) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function safeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function isOwnedAssetUrl(
  value: string,
  supabaseUrl: string,
  job: { owner_id: string; launch_item_id: string; id: string },
) {
  try {
    const url = new URL(value);
    const base = new URL(supabaseUrl);
    const expected = `/storage/v1/object/public/product-launch-assets/${safeSegment(job.owner_id)}/${safeSegment(job.launch_item_id)}/${safeSegment(job.id)}/`;
    return url.origin === base.origin && decodeURIComponent(url.pathname).startsWith(expected);
  } catch {
    return false;
  }
}

function safeSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 120);
}

function invalid(message: string) {
  return Response.json({ ok: false, code: "INVALID_DETAIL_PAGE_JOB", message }, { status: 400 });
}

function forbidden(message: string) {
  return Response.json({ ok: false, code: "DETAIL_PAGE_JOB_FORBIDDEN", message }, { status: 403 });
}

function notFound() {
  return Response.json({ ok: false, code: "DETAIL_PAGE_JOB_NOT_FOUND", message: "상세페이지 작업을 찾지 못했습니다." }, { status: 404 });
}

function failed(code: string, error: unknown, fallback: string) {
  return Response.json(
    { ok: false, code, message: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}
