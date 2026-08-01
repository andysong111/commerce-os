export type ShoplingCategoryRunLookupInput = {
  requestId?: string;
  startedAt?: string;
};

export type ShoplingCategoryRunState = {
  found: boolean;
  runId: number | null;
  requestId: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  actionsUrl: string;
  active: boolean;
  terminal: boolean;
};

type GitHubWorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at?: string;
  display_title?: string;
  name?: string;
  html_url?: string;
};

type GitHubWorkflowRunsResponse = {
  workflow_runs?: GitHubWorkflowRun[];
  message?: string;
};

const DEFAULT_REPO = "andysong111/shopling-product-upload-auto";
const DEFAULT_WORKFLOW = "shopling-category-refresh.yml";
const ACTIVE_STATUSES = new Set([
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

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function chooseRun(
  runs: GitHubWorkflowRun[],
  input: ShoplingCategoryRunLookupInput,
) {
  const sorted = [...runs].sort(
    (left, right) => timestamp(right.created_at) - timestamp(left.created_at),
  );
  const requestId = text(input.requestId);
  if (requestId) {
    const exact = sorted.find((run) =>
      `${text(run.display_title)} ${text(run.name)}`.includes(requestId),
    );
    if (exact) return exact;
  }

  const startedAt = timestamp(text(input.startedAt));
  if (startedAt) {
    const earliest = startedAt - 10 * 60 * 1_000;
    const latest = startedAt + 2 * 60 * 60 * 1_000;
    const sameWindow = sorted.find((run) => {
      const createdAt = timestamp(run.created_at);
      return createdAt >= earliest && createdAt <= latest;
    });
    if (sameWindow) return sameWindow;
  }

  return sorted[0] ?? null;
}

export async function fetchShoplingCategoryRunState(
  input: ShoplingCategoryRunLookupInput = {},
  options: { fetcher?: typeof fetch } = {},
): Promise<ShoplingCategoryRunState> {
  const config = getConfig();
  const fetcher = options.fetcher ?? fetch;
  const query = new URLSearchParams({
    event: "workflow_dispatch",
    branch: config.ref,
    per_page: "20",
  });
  const url = `https://api.github.com/repos/${config.owner}/${config.repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/runs?${query.toString()}`;
  const response = await fetcher(url, {
    headers: headers(config.token),
    cache: "no-store",
  });
  const raw = await response.text();
  let payload: GitHubWorkflowRunsResponse = {};
  try {
    payload = raw ? (JSON.parse(raw) as GitHubWorkflowRunsResponse) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(
      text(payload.message) ||
        `GitHub Actions 상태를 조회하지 못했습니다. HTTP ${response.status}`,
    );
  }

  const run = chooseRun(
    Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [],
    input,
  );
  if (!run) {
    return {
      found: false,
      runId: null,
      requestId: text(input.requestId),
      status: "not_found",
      conclusion: null,
      createdAt: "",
      updatedAt: "",
      actionsUrl: `https://github.com/${config.repo}/actions/workflows/${config.workflow}`,
      active: false,
      terminal: false,
    };
  }

  const status = text(run.status);
  const active = ACTIVE_STATUSES.has(status);
  return {
    found: true,
    runId: Number(run.id) || null,
    requestId: text(input.requestId),
    status,
    conclusion: run.conclusion ? text(run.conclusion) : null,
    createdAt: text(run.created_at),
    updatedAt: text(run.updated_at),
    actionsUrl: text(run.html_url),
    active,
    terminal: status === "completed" || (!active && Boolean(run.conclusion)),
  };
}
