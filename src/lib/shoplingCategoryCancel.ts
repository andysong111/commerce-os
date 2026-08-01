type GitHubWorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  display_title?: string;
  name?: string;
  html_url?: string;
  event?: string;
  head_branch?: string;
};

type GitHubWorkflowRunsResponse = {
  workflow_runs?: GitHubWorkflowRun[];
  message?: string;
};

export type CancelShoplingCategoryUpdateInput = {
  requestId?: string;
  startedAt?: string;
};

export type CancelShoplingCategoryUpdateResult = {
  ok: true;
  cancelled: boolean;
  status: "cancel_requested" | "no_active_run" | "already_finished";
  runId: number | null;
  actionsUrl: string;
  message: string;
};

const DEFAULT_REPO = "andysong111/shopling-product-upload-auto";
const DEFAULT_WORKFLOW = "shopling-category-refresh.yml";
const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "pending",
]);

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getConfig() {
  const repo = text(
    process.env.SHOPLING_CATEGORY_REPO ||
      process.env.SHOPLING_UPLOAD_REPO ||
      DEFAULT_REPO,
  );
  const workflow = text(
    process.env.SHOPLING_CATEGORY_WORKFLOW || DEFAULT_WORKFLOW,
  );
  const ref = text(
    process.env.SHOPLING_CATEGORY_REF || process.env.SHOPLING_UPLOAD_REF || "main",
  );
  const token = text(
    process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_ENGINE_DISPATCH_TOKEN,
  );
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("SHOPLING_CATEGORY_REPO는 owner/repo 형식이어야 합니다.");
  }
  if (!token) {
    throw new Error(
      "GITHUB_ACTIONS_TOKEN 또는 GITHUB_ENGINE_DISPATCH_TOKEN이 필요합니다.",
    );
  }
  const [owner, repoName] = repo.split("/");
  return { repo, owner, repoName, workflow, ref, token };
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function runTimestamp(run: GitHubWorkflowRun) {
  const timestamp = Date.parse(run.created_at || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function chooseCancelableShoplingCategoryRun(
  runs: GitHubWorkflowRun[],
  input: CancelShoplingCategoryUpdateInput,
) {
  const requestId = text(input.requestId);
  const startedAt = Date.parse(text(input.startedAt));
  const activeRuns = runs
    .filter((run) => ACTIVE_RUN_STATUSES.has(text(run.status)))
    .sort((left, right) => runTimestamp(right) - runTimestamp(left));

  if (requestId) {
    const exact = activeRuns.find((run) =>
      `${text(run.display_title)} ${text(run.name)}`.includes(requestId),
    );
    if (exact) return exact;
  }

  if (Number.isFinite(startedAt)) {
    const earliestAllowed = startedAt - 10 * 60 * 1_000;
    const sameWindow = activeRuns.find(
      (run) => runTimestamp(run) >= earliestAllowed,
    );
    if (sameWindow) return sameWindow;
  }

  // This is a dedicated workflow with a single concurrency group, so at most
  // one category update may be active. Falling back to the newest active run
  // safely supports older runs created before request_id was added to run-name.
  return activeRuns[0] ?? null;
}

async function readGitHubMessage(response: Response) {
  const raw = await response.text();
  if (!raw) return "";
  try {
    return text((JSON.parse(raw) as { message?: unknown }).message);
  } catch {
    return text(raw);
  }
}

export async function cancelShoplingCategoryUpdate(
  input: CancelShoplingCategoryUpdateInput,
  options: { fetcher?: typeof fetch } = {},
): Promise<CancelShoplingCategoryUpdateResult> {
  const config = getConfig();
  const fetcher = options.fetcher ?? fetch;
  const query = new URLSearchParams({
    event: "workflow_dispatch",
    branch: config.ref,
    per_page: "20",
  });
  const runsUrl = `https://api.github.com/repos/${config.owner}/${config.repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/runs?${query.toString()}`;
  const runsResponse = await fetcher(runsUrl, {
    headers: githubHeaders(config.token),
    cache: "no-store",
  });
  const rawRuns = await runsResponse.text();
  let payload: GitHubWorkflowRunsResponse = {};
  try {
    payload = rawRuns ? (JSON.parse(rawRuns) as GitHubWorkflowRunsResponse) : {};
  } catch {
    payload = {};
  }
  if (!runsResponse.ok) {
    throw new Error(
      text(payload.message) ||
        `GitHub Actions 실행 목록을 조회하지 못했습니다. HTTP ${runsResponse.status}`,
    );
  }

  const run = chooseCancelableShoplingCategoryRun(
    Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [],
    input,
  );
  if (!run) {
    return {
      ok: true,
      cancelled: false,
      status: "no_active_run",
      runId: null,
      actionsUrl: `https://github.com/${config.repo}/actions/workflows/${config.workflow}`,
      message:
        "실행 중인 카테고리 업데이트가 없습니다. 화면의 이전 진행 상태만 정리했습니다.",
    };
  }

  const cancelUrl = `https://api.github.com/repos/${config.owner}/${config.repoName}/actions/runs/${run.id}/cancel`;
  const cancelResponse = await fetcher(cancelUrl, {
    method: "POST",
    headers: githubHeaders(config.token),
    cache: "no-store",
  });
  if (cancelResponse.status === 409) {
    return {
      ok: true,
      cancelled: false,
      status: "already_finished",
      runId: run.id,
      actionsUrl: text(run.html_url),
      message:
        "GitHub Actions 작업이 이미 종료됐습니다. 화면의 이전 진행 상태만 정리했습니다.",
    };
  }
  if (!cancelResponse.ok && cancelResponse.status !== 202) {
    const message = await readGitHubMessage(cancelResponse);
    throw new Error(
      message ||
        `GitHub Actions 작업 취소에 실패했습니다. HTTP ${cancelResponse.status}`,
    );
  }

  return {
    ok: true,
    cancelled: true,
    status: "cancel_requested",
    runId: run.id,
    actionsUrl: text(run.html_url),
    message:
      "샵플링 카테고리 업데이트 취소를 요청했습니다. 잠시 후 다시 업데이트할 수 있습니다.",
  };
}
