import { NextResponse } from "next/server";
import { authorizeReliabilityGitHubRunner } from "@/lib/reliability/reliabilityGitHubOidc";
import {
  reportReliabilityAutoImprovement,
  type ReliabilityAutoImprovementReport,
} from "@/lib/reliability/reliabilityAutoImprovementStore";
import { redactReliabilityText } from "@/lib/reliability/reliabilityEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUSES = new Set<ReliabilityAutoImprovementReport["status"]>([
  "patch_created",
  "validating",
  "preview_passed",
  "merged",
  "production_verified",
  "failed",
  "rolled_back",
]);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function optionalUrl(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function optionalSha(value: unknown) {
  const text = String(value ?? "").trim();
  return /^[0-9a-f]{7,64}$/i.test(text) ? text : undefined;
}

export async function POST(request: Request) {
  const authorization = await authorizeReliabilityGitHubRunner(request);
  if (!authorization.ok) {
    return json({ ok: false, message: authorization.message }, authorization.status);
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const jobId = String(body.job_id ?? "").trim();
  const leaseToken = String(body.lease_token ?? "").trim();
  const status = String(body.status ?? "") as ReliabilityAutoImprovementReport["status"];
  if (!jobId || !leaseToken || !STATUSES.has(status)) {
    return json({ ok: false, message: "자동개선 진행 보고 형식이 올바르지 않습니다." }, 400);
  }

  const prValue = Number(body.pr_number ?? 0);
  const validation =
    body.validation && typeof body.validation === "object" && !Array.isArray(body.validation)
      ? (body.validation as Record<string, unknown>)
      : undefined;
  const report: ReliabilityAutoImprovementReport = {
    jobId,
    leaseToken,
    status,
    branchName: String(body.branch_name ?? "").trim().slice(0, 300) || undefined,
    prNumber: Number.isInteger(prValue) && prValue > 0 ? prValue : undefined,
    headSha: optionalSha(body.head_sha),
    mergeSha: optionalSha(body.merge_sha),
    previewUrl: optionalUrl(body.preview_url),
    productionUrl: optionalUrl(body.production_url),
    validation,
    error: body.error
      ? redactReliabilityText(String(body.error), 1_500)
      : undefined,
  };

  try {
    const result = await reportReliabilityAutoImprovement(
      authorization.identity.repository,
      report,
    );
    return json(result);
  } catch (error) {
    return json(
      {
        ok: false,
        message: redactReliabilityText(
          error instanceof Error ? error.message : String(error ?? "자동개선 진행 보고 실패"),
          1_000,
        ),
      },
      409,
    );
  }
}
