import { randomUUID } from "node:crypto";

import { buildProductLaunchShoplingPayload } from "@/lib/productLaunchTrackerShopling";
import {
  readProductLaunchError,
  readResponseJson,
} from "@/lib/productLaunchTrackerServer";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import type { SeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import {
  decorateSeoShoplingBulkPayload,
  readSeoShoplingLaunchState,
} from "@/lib/seoShoplingLiveRegistration";

export type PreparedSeoShoplingProductUpload = {
  jobId: string;
  requestId: string;
  actionsUrl: string;
  url: string;
  token: string;
  body: Record<string, unknown>;
};

export async function prepareSeoShoplingProductUpload(
  context: SeoTitleLedgerContext,
  input: {
    launchItemId: string;
    dispatchId: string;
    ledgerId: string;
    reservationId: string;
    canonicalSeed: boolean;
  },
): Promise<PreparedSeoShoplingProductUpload> {
  const { item, policy } = await readSeoShoplingLaunchState(
    context,
    input.launchItemId,
  );
  const repo = process.env.SHOPLING_UPLOAD_REPO?.trim();
  const workflow =
    process.env.SHOPLING_LAUNCH_UPLOAD_WORKFLOW?.trim() ||
    "shopling-product-launch-upload.yml";
  const ref = process.env.SHOPLING_UPLOAD_REF?.trim() || "main";
  const token = process.env.GITHUB_ACTIONS_TOKEN?.trim();
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo) || !token) {
    throw new Error(
      "SHOPLING_UPLOAD_REPO와 GITHUB_ACTIONS_TOKEN 환경변수가 필요합니다.",
    );
  }

  const jobId = randomUUID();
  const requestId = `seo-bulk-${Date.now()}-${jobId.slice(0, 8)}`;
  const basePayload = buildProductLaunchShoplingPayload(item, policy, requestId);
  const payload = decorateSeoShoplingBulkPayload(basePayload, {
    dispatchId: input.dispatchId,
    ledgerId: input.ledgerId,
    reservationId: input.reservationId,
    canonicalSeed: input.canonicalSeed,
  });
  const now = new Date().toISOString();
  const response = await fetch(
    `${context.config.supabaseUrl}/rest/v1/product_launch_upload_jobs`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(context.config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id: jobId,
        owner_id: context.identity.userId,
        owner_email: context.identity.email,
        launch_item_id: input.launchItemId,
        request_id: requestId,
        status: "queued",
        payload,
        created_at: now,
        updated_at: now,
      }),
      cache: "no-store",
    },
  );
  const responseBody = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(responseBody, response.status));
  }

  return {
    jobId,
    requestId,
    actionsUrl: `https://github.com/${repo}/actions/workflows/${encodeURIComponent(workflow)}`,
    url: `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    token,
    body: { ref, inputs: { job_id: jobId, request_id: requestId } },
  };
}

export async function dispatchPreparedSeoShoplingProductUpload(
  prepared: PreparedSeoShoplingProductUpload,
) {
  const response = await fetch(prepared.url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${prepared.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(prepared.body),
    cache: "no-store",
  });
  if (![200, 204].includes(response.status)) {
    const detail = await response.text();
    const error = new Error(
      `샵플링 상품 6개 GitHub Actions 실행 요청에 실패했습니다. status=${response.status}${detail ? ` body=${detail.slice(0, 220)}` : ""}`,
    ) as Error & { definitelyNotAccepted?: boolean };
    error.definitelyNotAccepted = true;
    throw error;
  }
  return {
    status: "queued" as const,
    jobId: prepared.jobId,
    requestId: prepared.requestId,
    actionsUrl: prepared.actionsUrl,
  };
}
