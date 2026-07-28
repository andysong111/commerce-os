import { randomBytes } from "node:crypto";
import { unzipSync } from "fflate";

export const KEYWORD_SHOPLING_DIRECT_APPLY_WORKFLOW =
  "keyword-shopling-direct-apply.yml";
export const KEYWORD_SHOPLING_DIRECT_APPLY_ARTIFACT =
  "keyword-shopling-direct-apply-result";
export const KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION =
  "APPLY_REVIEWED_TITLES_AND_SEARCH_TO_SHOPLING";
export const KEYWORD_SHOPLING_DIRECT_APPLY_REQUEST_ID_PATTERN =
  /^[A-Za-z0-9._:-]{1,120}$/;

const MALL_KEY_PATTERN = /^SMALL_\d{5}$/;
const MAX_ITEMS = 100;
const PLAN_KEYS = [
  "final_site_srch",
  "final_title",
  "goods_key",
  "mall_key",
] as const;

type Config = {
  repo: string;
  ref: string;
  token: string;
};

type DirectPlanItem = {
  goods_key: string;
  mall_key: string;
  final_title: string;
  final_site_srch: string;
};

type WorkflowRun = {
  id?: number;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  display_title?: string;
  name?: string;
};

type GithubArtifact = {
  name?: string;
  archive_download_url?: string;
};

export type DirectApplySummary = Record<string, unknown>;
export type DirectApplyRow = Record<string, unknown>;

function config(): Config {
  const repo = process.env.KEYWORD_SHOPLING_APPLY_REPO?.trim();
  const ref = process.env.KEYWORD_SHOPLING_APPLY_REF?.trim();
  const token = process.env.KEYWORD_SHOPLING_APPLY_ACTIONS_TOKEN?.trim();
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo))
    throw new Error(
      "KEYWORD_SHOPLING_APPLY_REPO는 owner/repo 형식으로 설정해야 합니다.",
    );
  if (!ref) throw new Error("KEYWORD_SHOPLING_APPLY_REF 환경변수가 필요합니다.");
  if (!token)
    throw new Error(
      "KEYWORD_SHOPLING_APPLY_ACTIONS_TOKEN 환경변수가 필요합니다.",
    );
  return { repo, ref, token };
}

function enabled() {
  return process.env.KEYWORD_SHOPLING_APPLY_ENABLED === "1";
}

function headers(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `GitHub API 요청에 실패했습니다. status=${response.status}`,
    );
  return text ? JSON.parse(text) : {};
}

function normalizeSearch(value: string) {
  const tokens = value
    .split(/[,\n;|/]+|\s{2,}/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return [...new Set(tokens)];
}

export function parseKeywordShoplingDirectPlan(
  raw: unknown,
): DirectPlanItem[] {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_ITEMS)
    throw new Error("실행 계획은 1개부터 100개 사이여야 합니다.");

  const seenTargets = new Set<string>();
  const searchByGoodsKey = new Map<string, string>();

  return parsed.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`실행 계획 ${index + 1}행 형식이 올바르지 않습니다.`);
    const item = value as Record<string, unknown>;
    const keys = Object.keys(item).sort();
    if (
      keys.length !== PLAN_KEYS.length ||
      keys.some((key, keyIndex) => key !== PLAN_KEYS[keyIndex])
    )
      throw new Error("검토 완료된 간소화 실행 계획만 사용할 수 있습니다.");

    const goodsKey = String(item.goods_key ?? "").trim();
    const mallKey = String(item.mall_key ?? "").trim();
    const finalTitle = String(item.final_title ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const searchTokens = normalizeSearch(String(item.final_site_srch ?? ""));
    const finalSiteSrch = searchTokens.join(",");

    if (!/^\d+$/.test(goodsKey)) throw new Error("goods_key 형식이 올바르지 않습니다.");
    if (!MALL_KEY_PATTERN.test(mallKey))
      throw new Error("mall_key 형식이 올바르지 않습니다.");
    if (!finalTitle || finalTitle === "-" || /^\d+$/.test(finalTitle))
      throw new Error("쇼핑몰별 상품명이 필요합니다.");
    if (new TextEncoder().encode(finalTitle).length > 100)
      throw new Error("쇼핑몰별 상품명은 UTF-8 기준 100bytes 이하여야 합니다.");
    if (searchTokens.length < 1 || searchTokens.length > 10)
      throw new Error("검색어는 1개부터 10개까지 사용할 수 있습니다.");

    const target = `${goodsKey}:${mallKey}`;
    if (seenTargets.has(target))
      throw new Error("동일한 goods_key와 mall_key가 중복되었습니다.");
    seenTargets.add(target);

    const previousSearch = searchByGoodsKey.get(goodsKey);
    if (previousSearch !== undefined && previousSearch !== finalSiteSrch)
      throw new Error("같은 goods_key의 검색어 값은 모두 동일해야 합니다.");
    searchByGoodsKey.set(goodsKey, finalSiteSrch);

    return {
      goods_key: goodsKey,
      mall_key: mallKey,
      final_title: finalTitle,
      final_site_srch: finalSiteSrch,
    };
  });
}

export function generateKeywordShoplingDirectApplyRequestId(now = new Date()) {
  return `direct-apply-${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")}-${randomBytes(3).toString("hex")}`;
}

export function isValidKeywordShoplingDirectApplyRequestId(requestId: string) {
  return KEYWORD_SHOPLING_DIRECT_APPLY_REQUEST_ID_PATTERN.test(requestId);
}

export function buildKeywordShoplingDirectApplyDispatch(input: {
  execution_plan_json?: unknown;
  confirmation_text?: unknown;
  max_items?: unknown;
}) {
  const plan = parseKeywordShoplingDirectPlan(input.execution_plan_json);
  if (input.confirmation_text !== KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION)
    throw new Error("실제 반영 확인문구가 올바르지 않습니다.");
  const maxItems = Number(input.max_items ?? MAX_ITEMS);
  if (!Number.isInteger(maxItems) || maxItems < plan.length || maxItems > MAX_ITEMS)
    throw new Error("max_items 값이 실행 계획 범위와 맞지 않습니다.");

  const current = config();
  const [owner, repo] = current.repo.split("/");
  const requestId = generateKeywordShoplingDirectApplyRequestId();
  const workflow = KEYWORD_SHOPLING_DIRECT_APPLY_WORKFLOW;
  return {
    url: `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    githubActionsUrl: `https://github.com/${current.repo}/actions/workflows/${encodeURIComponent(workflow)}`,
    token: current.token,
    requestId,
    body: {
      ref: current.ref,
      inputs: {
        execution_plan_json: JSON.stringify(plan),
        confirmation_text: KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
        request_id: requestId,
        max_items: String(maxItems),
      },
    },
    itemCount: plan.length,
  };
}

export async function dispatchKeywordShoplingDirectApply(input: {
  execution_plan_json?: unknown;
  confirmation_text?: unknown;
  max_items?: unknown;
}) {
  if (!enabled())
    return {
      status: "error",
      message:
        "KEYWORD_SHOPLING_APPLY_ENABLED=1 인 경우에만 실행할 수 있습니다.",
    };
  let request;
  try {
    request = buildKeywordShoplingDirectApplyDispatch(input);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "실행 입력값이 올바르지 않습니다.",
    };
  }

  const response = await fetch(request.url, {
    method: "POST",
    headers: { ...headers(request.token), "Content-Type": "application/json" },
    body: JSON.stringify(request.body),
  });
  if (![200, 204].includes(response.status))
    return {
      status: "error",
      message: `GitHub Actions 실행 요청에 실패했습니다. status=${response.status}`,
      requestId: request.requestId,
      githubActionsUrl: request.githubActionsUrl,
    };

  return {
    status: "queued",
    phase: "queued",
    requestId: request.requestId,
    githubActionsUrl: request.githubActionsUrl,
    runUrl: request.githubActionsUrl,
    itemCount: request.itemCount,
    message: "상품명과 검색어 반영을 시작했습니다.",
  };
}

const SUMMARY_KEYS = [
  "request_id",
  "status",
  "phase",
  "input_item_count",
  "valid_item_count",
  "blocked_item_count",
  "unique_goods_key_count",
  "applied_item_count",
  "failed_item_count",
  "search_apply_success_count",
  "search_apply_not_applied_count",
  "search_preverified_goods_key_count",
  "search_write_goods_key_count",
  "search_batch_request_count",
  "title_apply_success_count",
  "title_apply_not_applied_count",
  "title_apply_unverified_count",
  "title_write_request_count",
  "title_write_failed_count",
  "title_retry_request_count",
  "admin_readback_request_count",
  "serial_failure_goods_key",
  "serial_failure_mall_key",
  "price_repair_required",
  "requires_final_price_pass",
  "direct_apply_completed",
  "execution_strategy",
  "api_transcript_count",
  "elapsed_seconds",
  "errors",
  "warnings",
  "created_at",
] as const;

const ROW_KEYS = [
  "goods_key",
  "mall_key",
  "requested_mall_title",
  "requested_site_srch",
  "site_srch_update_status",
  "title_update_status",
  "mall_title_apply_status",
  "title_write_status",
  "title_write_attempt_count",
  "title_api_response_code",
  "title_api_response_msg",
  "search_api_response_code",
  "search_api_response_msg",
  "price_repair_required",
] as const;

function safeSummary(value: unknown): DirectApplySummary {
  const result: DirectApplySummary = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const key of SUMMARY_KEYS)
    if (key in value) result[key] = (value as Record<string, unknown>)[key];
  return result;
}

function safeRow(value: unknown): DirectApplyRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: DirectApplyRow = {};
  for (const key of ROW_KEYS)
    if (key in value) result[key] = (value as Record<string, unknown>)[key];
  return result;
}

function parseJsonl(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return safeRow(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((row): row is DirectApplyRow => Boolean(row));
}

function artifactFile(files: Record<string, Uint8Array>, name: string) {
  return Object.keys(files).find(
    (path) =>
      path === name ||
      path.endsWith(`/shopling_direct_apply/${name}`) ||
      path.endsWith(`/${name}`),
  );
}

export function extractKeywordShoplingDirectApplyArtifact(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const decoder = new TextDecoder();
  const summaryPath = artifactFile(files, "result_summary.json");
  if (!summaryPath)
    throw new Error("결과 artifact에서 result_summary.json을 찾을 수 없습니다.");
  const applyPath = artifactFile(files, "apply_results.jsonl");
  const blockedPath = artifactFile(files, "blocked_items.jsonl");
  return {
    summary: safeSummary(JSON.parse(decoder.decode(files[summaryPath]))),
    applyResults: applyPath ? parseJsonl(decoder.decode(files[applyPath])) : [],
    blockedItems: blockedPath ? parseJsonl(decoder.decode(files[blockedPath])) : [],
  };
}

function runMatchesRequest(run: WorkflowRun, requestId: string) {
  const title = `${run.display_title ?? ""} ${run.name ?? ""}`;
  return title.includes(requestId);
}

export async function fetchKeywordShoplingDirectApplyResult(requestId: string) {
  if (!isValidKeywordShoplingDirectApplyRequestId(requestId))
    return {
      status: "error",
      phase: "unknown",
      requestId,
      message: "요청 추적 ID 형식이 올바르지 않습니다.",
    };
  if (!enabled())
    return {
      status: "error",
      phase: "unknown",
      requestId,
      message:
        "KEYWORD_SHOPLING_APPLY_ENABLED=1 인 경우에만 결과를 확인할 수 있습니다.",
    };

  const current = config();
  const [owner, repo] = current.repo.split("/");
  const workflow = KEYWORD_SHOPLING_DIRECT_APPLY_WORKFLOW;
  const params = new URLSearchParams({
    branch: current.ref,
    event: "workflow_dispatch",
    per_page: "30",
  });
  const runsResult = await readJson(
    await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?${params}`,
      { headers: headers(current.token) },
    ),
  );
  const runs = (Array.isArray(runsResult.workflow_runs)
    ? runsResult.workflow_runs
    : []) as WorkflowRun[];
  let matchingPending: WorkflowRun | undefined;

  for (const run of runs) {
    const runId = Number(run.id);
    if (!Number.isFinite(runId)) continue;
    const artifactsResult = await readJson(
      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`,
        { headers: headers(current.token) },
      ),
    );
    const artifact = (Array.isArray(artifactsResult.artifacts)
      ? artifactsResult.artifacts
      : []
    ).find(
      (item: GithubArtifact) =>
        item?.name === KEYWORD_SHOPLING_DIRECT_APPLY_ARTIFACT,
    ) as GithubArtifact | undefined;

    if (!artifact?.archive_download_url) {
      if (runMatchesRequest(run, requestId)) matchingPending = run;
      continue;
    }
    const response = await fetch(artifact.archive_download_url, {
      headers: headers(current.token),
    });
    if (!response.ok) continue;
    const extracted = extractKeywordShoplingDirectApplyArtifact(
      new Uint8Array(await response.arrayBuffer()),
    );
    if (String(extracted.summary.request_id ?? "") !== requestId) continue;
    const failed = ["failed", "partial_failure", "blocked"].includes(
      String(extracted.summary.status ?? ""),
    );
    return {
      status: failed ? "error" : "success",
      phase: failed ? "failed" : "artifact_ready",
      requestId,
      runId,
      runUrl: run.html_url,
      runStatus: run.status,
      runConclusion: run.conclusion,
      message: failed
        ? "상품명·검색어 반영 중 실패가 발생했습니다."
        : "상품명과 검색어 반영 결과를 확인했습니다.",
      ...extracted,
    };
  }

  if (matchingPending) {
    const completed = matchingPending.status === "completed";
    return {
      status: completed ? "error" : "pending",
      phase: completed
        ? "completed_no_artifact"
        : matchingPending.status === "queued"
          ? "queued"
          : "running",
      requestId,
      runId: matchingPending.id,
      runUrl: matchingPending.html_url,
      runStatus: matchingPending.status,
      runConclusion: matchingPending.conclusion,
      message: completed
        ? "실행은 종료됐지만 결과 artifact를 찾지 못했습니다."
        : "GitHub Actions에서 상품명과 검색어를 반영하고 있습니다.",
    };
  }

  return {
    status: "pending",
    phase: "waiting_artifact",
    requestId,
    message: "해당 요청의 실행 또는 결과 artifact를 기다리고 있습니다.",
  };
}
