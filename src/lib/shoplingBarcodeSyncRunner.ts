import { randomBytes } from "node:crypto";
import { unzipSync } from "fflate";

export const SHOPLING_BARCODE_SYNC_DEFAULT_REPO = "andysong111/commerce-os-shopling-barcode-sync-11";
export const SHOPLING_BARCODE_SYNC_DEFAULT_WORKFLOW = "shopling-barcode-sync.yml";
export const SHOPLING_BARCODE_SYNC_DEFAULT_REF = "main";
export const SHOPLING_BARCODE_SYNC_VERIFIED_CANARY_KEYS = [
  "117305",
  "117308",
  "117311",
  "100049",
  "100034",
  "102648",
  "110791",
  "116737",
  "109791",
  "121102",
] as const;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
const GOODS_KEY_PATTERN = /^\d+$/;
const RESULT_WINDOW_BEFORE_MS = 5 * 60_000;
const RESULT_WINDOW_AFTER_MS = 8 * 60 * 60_000;
const MODES = new Set(["plan", "canary", "apply", "retry"]);
const APPLY_SCOPES = new Set(["oldest_1000", "oldest_2000", "all"]);

export type ShoplingBarcodeSyncMode = "plan" | "canary" | "apply" | "retry";
export type ShoplingBarcodeSyncApplyScope = "oldest_1000" | "oldest_2000" | "all";

export type ShoplingBarcodeSyncRunInput = {
  mode: ShoplingBarcodeSyncMode;
  apply_scope?: ShoplingBarcodeSyncApplyScope;
  target_goods_keys?: string;
  confirm_text?: string;
  canary_count?: number;
};

export type ShoplingBarcodeSyncSummary = {
  request_id?: unknown;
  mode?: unknown;
  apply_scope?: unknown;
  generated_at?: unknown;
  scanned_products?: unknown;
  total_options?: unknown;
  change_required_products?: unknown;
  already_synced_products?: unknown;
  blocked_products?: unknown;
  changed_options?: unknown;
  fill_options?: unknown;
  replace_options?: unknown;
  clear_options?: unknown;
  unchanged_options?: unknown;
  partial_blank_products?: unknown;
  all_blank_source_products?: unknown;
  collection_errors?: unknown;
  execution_selection?: {
    selected_products?: unknown;
    selected_options_to_change?: unknown;
    remaining_change_required_after_selection?: unknown;
    oldest_selected_registration_window?: unknown;
    newest_selected_registration_window?: unknown;
  } | unknown;
  execution?: {
    selected_products?: unknown;
    attempted_products?: unknown;
    success?: unknown;
    failed?: unknown;
    unknown?: unknown;
    skipped?: unknown;
    stopped_early?: unknown;
    stop_reason?: unknown;
  } | unknown;
};

export type ShoplingBarcodeSyncDispatchResult = {
  status: "queued" | "error";
  message: string;
  requestId?: string;
  githubActionsUrl?: string;
};

export type ShoplingBarcodeSyncActionsResult = {
  status: "success" | "pending" | "error";
  message?: string;
  requestId?: string;
  runId?: number;
  runUrl?: string;
  runStatus?: string;
  runConclusion?: string | null;
  artifactName?: string;
  summary?: ShoplingBarcodeSyncSummary;
};

type Config = {
  repo: string;
  workflow: string;
  ref: string;
  token: string;
};

type GithubWorkflowRun = {
  id?: number;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  display_title?: string;
  run_started_at?: string;
  created_at?: string;
};

type GithubArtifact = {
  name?: string;
  archive_download_url?: string;
};

function getConfig(): Config {
  const repo = process.env.SHOPLING_BARCODE_SYNC_REPO?.trim() || SHOPLING_BARCODE_SYNC_DEFAULT_REPO;
  const workflow = process.env.SHOPLING_BARCODE_SYNC_WORKFLOW?.trim() || SHOPLING_BARCODE_SYNC_DEFAULT_WORKFLOW;
  const ref = process.env.SHOPLING_BARCODE_SYNC_REF?.trim() || SHOPLING_BARCODE_SYNC_DEFAULT_REF;
  const token =
    process.env.SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN?.trim() ||
    process.env.GITHUB_ACTIONS_TOKEN?.trim() ||
    process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN?.trim();

  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("SHOPLING_BARCODE_SYNC_REPO는 owner/repo 형식이어야 합니다.");
  }
  if (!workflow) throw new Error("SHOPLING_BARCODE_SYNC_WORKFLOW 설정이 비어 있습니다.");
  if (!ref) throw new Error("SHOPLING_BARCODE_SYNC_REF 설정이 비어 있습니다.");
  if (!token) {
    throw new Error(
      "SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN, GITHUB_ACTIONS_TOKEN 또는 SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN이 필요합니다.",
    );
  }
  return { repo, workflow, ref, token };
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API 요청 실패 status=${response.status}${text ? ` body=${text.slice(0, 300)}` : ""}`);
  }
  return text ? JSON.parse(text) : {};
}

function normalizeGoodsKeys(raw: string) {
  const values = raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const deduped = [...new Set(values)];
  if (deduped.some((value) => !GOODS_KEY_PATTERN.test(value))) {
    throw new Error("goods_key는 숫자만 입력할 수 있습니다.");
  }
  if (deduped.length > 2000) throw new Error("goods_key는 최대 2,000개까지 입력할 수 있습니다.");
  return deduped;
}

export function generateShoplingBarcodeSyncRequestId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `barcode-sync-${timestamp}-${randomBytes(3).toString("hex")}`;
}

export function isValidShoplingBarcodeSyncRequestId(value: string) {
  return REQUEST_ID_PATTERN.test(value);
}

export function parseShoplingBarcodeSyncRequestTimestamp(requestId: string) {
  const match = requestId.match(/^barcode-sync-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[0-9a-f]{6}$/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const value = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(value.getTime()) &&
    value.toISOString() === `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`
    ? value
    : null;
}

export function validateShoplingBarcodeSyncRunInput(input: ShoplingBarcodeSyncRunInput) {
  const mode = input.mode;
  if (!MODES.has(mode)) throw new Error("실행 모드가 올바르지 않습니다.");
  const applyScope = input.apply_scope || "oldest_2000";
  if (!APPLY_SCOPES.has(applyScope)) throw new Error("대량 반영 범위가 올바르지 않습니다.");

  const canaryCount = Number(input.canary_count ?? 10);
  if (!Number.isInteger(canaryCount) || canaryCount < 1 || canaryCount > 50) {
    throw new Error("테스트 상품 수는 1~50 사이 정수여야 합니다.");
  }

  const goodsKeys = normalizeGoodsKeys(input.target_goods_keys || "");
  const expectedConfirmation: Partial<Record<ShoplingBarcodeSyncMode, string>> = {
    canary: "테스트반영",
    apply: "전체반영",
    retry: "실패재시도",
  };
  const expected = expectedConfirmation[mode];
  const confirmText = input.confirm_text || "";
  if (expected && confirmText !== expected) {
    throw new Error(`${mode} 실행에는 확인문구 '${expected}'가 필요합니다.`);
  }
  if (mode === "retry" && goodsKeys.length === 0) {
    throw new Error("실패 재시도에는 goods_key가 필요합니다.");
  }

  return {
    mode,
    applyScope: applyScope as ShoplingBarcodeSyncApplyScope,
    goodsKeys,
    goodsKeysCsv: goodsKeys.join(","),
    confirmText,
    canaryCount,
  };
}

export function buildShoplingBarcodeSyncDispatchRequest(input: ShoplingBarcodeSyncRunInput, now = new Date()) {
  const normalized = validateShoplingBarcodeSyncRunInput(input);
  const config = getConfig();
  const [owner, repoName] = config.repo.split("/");
  const requestId = generateShoplingBarcodeSyncRequestId(now);
  return {
    url: `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`,
    token: config.token,
    requestId,
    githubActionsUrl: `https://github.com/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}`,
    body: {
      ref: config.ref,
      inputs: {
        request_id: requestId,
        mode: normalized.mode,
        apply_scope: normalized.applyScope,
        target_goods_keys: normalized.goodsKeysCsv,
        confirm_text: normalized.confirmText,
        canary_count: String(normalized.canaryCount),
      },
    },
  };
}

export async function dispatchShoplingBarcodeSyncActions(
  input: ShoplingBarcodeSyncRunInput,
): Promise<ShoplingBarcodeSyncDispatchResult> {
  let request;
  try {
    request = buildShoplingBarcodeSyncDispatchRequest(input);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "입력값이 올바르지 않습니다.",
    };
  }

  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: { ...githubHeaders(request.token), "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
    if (response.status !== 204 && response.status !== 200) {
      return {
        status: "error",
        message: `GitHub Actions 실행 요청 실패 status=${response.status}`,
        requestId: request.requestId,
        githubActionsUrl: request.githubActionsUrl,
      };
    }
    return {
      status: "queued",
      message: "샵플링 옵션 바코드 동기화 작업을 시작했습니다.",
      requestId: request.requestId,
      githubActionsUrl: request.githubActionsUrl,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "GitHub Actions 실행 요청 중 오류가 발생했습니다.",
      requestId: request.requestId,
      githubActionsUrl: request.githubActionsUrl,
    };
  }
}

function findSummaryPath(files: Record<string, Uint8Array>) {
  if (files["result_summary.json"]) return "result_summary.json";
  return Object.keys(files)
    .filter((name) => name.endsWith("/result_summary.json"))
    .sort()
    .at(0);
}

export function extractShoplingBarcodeSyncResultSummary(zipBytes: Uint8Array) {
  const files = unzipSync(zipBytes);
  const path = findSummaryPath(files);
  if (!path) throw new Error("결과 파일에서 result_summary.json을 찾을 수 없습니다.");
  return JSON.parse(new TextDecoder().decode(files[path])) as ShoplingBarcodeSyncSummary;
}

export function buildShoplingBarcodeSyncRunsUrl(requestId: string) {
  if (!isValidShoplingBarcodeSyncRequestId(requestId)) throw new Error("요청 추적 ID 형식이 올바르지 않습니다.");
  const config = getConfig();
  const [owner, repoName] = config.repo.split("/");
  const requestTime = parseShoplingBarcodeSyncRequestTimestamp(requestId);
  const params = new URLSearchParams({
    branch: config.ref,
    event: "workflow_dispatch",
    per_page: "100",
  });
  if (requestTime) {
    params.set(
      "created",
      `${new Date(requestTime.getTime() - RESULT_WINDOW_BEFORE_MS).toISOString()}..${new Date(
        requestTime.getTime() + RESULT_WINDOW_AFTER_MS,
      ).toISOString()}`,
    );
  }
  return {
    url: `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/runs?${params.toString()}`,
    token: config.token,
    repo: config.repo,
  };
}

export async function fetchShoplingBarcodeSyncActionsResult(
  requestId: string,
): Promise<ShoplingBarcodeSyncActionsResult> {
  if (!isValidShoplingBarcodeSyncRequestId(requestId)) {
    return { status: "error", message: "요청 추적 ID 형식이 올바르지 않습니다.", requestId };
  }

  let runsRequest;
  try {
    runsRequest = buildShoplingBarcodeSyncRunsUrl(requestId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "GitHub Actions 설정이 올바르지 않습니다.",
      requestId,
    };
  }

  try {
    const runsJson = await readJson(await fetch(runsRequest.url, { headers: githubHeaders(runsRequest.token) }));
    const workflowRuns = Array.isArray(runsJson.workflow_runs) ? (runsJson.workflow_runs as GithubWorkflowRun[]) : [];
    const run = workflowRuns.find((item) => typeof item.display_title === "string" && item.display_title.includes(requestId));

    if (!run) {
      return {
        status: "pending",
        message: "해당 요청의 GitHub Actions 실행을 찾는 중입니다. 잠시 후 다시 확인하세요.",
        requestId,
      };
    }

    const runId = Number(run.id);
    const base = {
      requestId,
      runId: Number.isFinite(runId) ? runId : undefined,
      runUrl: run.html_url,
      runStatus: run.status,
      runConclusion: typeof run.conclusion === "string" ? run.conclusion : null,
    };
    if (run.status !== "completed" || !Number.isFinite(runId)) {
      return {
        status: "pending",
        message: "작업이 실행 중입니다. 완료 후 결과를 다시 확인하세요.",
        ...base,
      };
    }

    const artifactsJson = await readJson(
      await fetch(`https://api.github.com/repos/${runsRequest.repo}/actions/runs/${runId}/artifacts`, {
        headers: githubHeaders(runsRequest.token),
      }),
    );
    const artifact = (Array.isArray(artifactsJson.artifacts) ? artifactsJson.artifacts : []).find(
      (item: GithubArtifact) =>
        typeof item.name === "string" && item.name.startsWith("shopling-barcode-sync-") && item.archive_download_url,
    ) as GithubArtifact | undefined;

    if (!artifact?.archive_download_url) {
      return {
        status: "pending",
        message: "실행은 끝났지만 결과 파일 업로드를 기다리고 있습니다.",
        ...base,
      };
    }

    const zipResponse = await fetch(artifact.archive_download_url, {
      headers: githubHeaders(runsRequest.token),
    });
    if (!zipResponse.ok) {
      throw new Error(`결과 파일 다운로드 실패 status=${zipResponse.status}`);
    }
    const summary = extractShoplingBarcodeSyncResultSummary(new Uint8Array(await zipResponse.arrayBuffer()));
    if (summary.request_id !== requestId) {
      throw new Error("결과 파일의 request_id가 현재 요청과 일치하지 않습니다.");
    }

    return {
      status: "success",
      message: run.conclusion === "success" ? "작업이 완료되었습니다." : "작업이 종료되었습니다. 실패 항목을 확인하세요.",
      ...base,
      artifactName: artifact.name,
      summary,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "실행 결과를 가져오는 중 오류가 발생했습니다.",
      requestId,
    };
  }
}
