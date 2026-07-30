const DEFAULT_MAX_PAGES = 2;
const DEFAULT_GRACE_MS = 30_000;

type GithubWorkflowRun = {
  id?: number;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  display_title?: string;
  name?: string;
  updated_at?: string;
};

type GithubArtifact = {
  name?: string;
};

export type TerminalGithubWorkflowFailure = {
  runId: number;
  runUrl?: string;
  conclusion: string | null;
  message: string;
};

type FailureCheckInput = {
  requestId: string;
  workflow: string;
  artifactName: string;
  operationLabel: string;
  now?: Date;
  graceMs?: number;
};

function getConfig() {
  const repo = process.env.SHOPLING_PRICE_MODIFY_REPO?.trim();
  const ref = process.env.SHOPLING_PRICE_MODIFY_REF?.trim();
  const token = process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN?.trim()
    || process.env.GITHUB_ACTIONS_TOKEN?.trim();
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo) || !ref || !token) return null;
  return { repo, ref, token };
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
  if (!response.ok) {
    throw new Error(
      `GitHub API 요청 실패 status=${response.status}${
        text ? ` body=${text.slice(0, 300)}` : ""
      }`,
    );
  }
  return text ? JSON.parse(text) : {};
}

function requestDate(requestId: string) {
  const match = requestId.match(/-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const value = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(value.getTime()) ? value : null;
}

export function githubWorkflowRunMatchesRequestId(
  run: GithubWorkflowRun,
  requestId: string,
) {
  return [run.display_title, run.name].some(
    (value) => typeof value === "string" && value.includes(requestId),
  );
}

function isPastArtifactGrace(
  run: GithubWorkflowRun,
  now: Date,
  graceMs: number,
) {
  const updatedAt = typeof run.updated_at === "string"
    ? Date.parse(run.updated_at)
    : Number.NaN;
  return !Number.isFinite(updatedAt) || now.getTime() - updatedAt >= graceMs;
}

function conclusionLabel(conclusion: string | null) {
  const labels: Record<string, string> = {
    failure: "실패",
    cancelled: "취소",
    timed_out: "시간 초과",
    action_required: "추가 조치 필요",
    startup_failure: "시작 실패",
    stale: "중단",
    skipped: "건너뜀",
    neutral: "중립 종료",
    success: "성공",
  };
  return conclusion ? labels[conclusion] ?? conclusion : "알 수 없는 상태";
}

export async function findTerminalGithubWorkflowFailure({
  requestId,
  workflow,
  artifactName,
  operationLabel,
  now = new Date(),
  graceMs = DEFAULT_GRACE_MS,
}: FailureCheckInput): Promise<TerminalGithubWorkflowFailure | null> {
  if (!requestId || !workflow || !artifactName) return null;
  const config = getConfig();
  if (!config) return null;
  const [owner, repoName] = config.repo.split("/");
  const requestedAt = requestDate(requestId);
  const created = requestedAt
    ? `${
      new Date(requestedAt.getTime() - 5 * 60_000).toISOString()
    }..${new Date(requestedAt.getTime() + 60 * 60_000).toISOString()}`
    : undefined;

  try {
    for (let page = 1; page <= DEFAULT_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        branch: config.ref,
        event: "workflow_dispatch",
        status: "completed",
        per_page: "100",
        page: String(page),
      });
      if (created) params.set("created", created);
      const runsUrl =
        `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${
          encodeURIComponent(workflow)
        }/runs?${params.toString()}`;
      const runsJson = await readJson(
        await fetch(runsUrl, { headers: headers(config.token) }),
      );
      const runs = Array.isArray(runsJson.workflow_runs)
        ? runsJson.workflow_runs as GithubWorkflowRun[]
        : [];

      for (const run of runs) {
        if (!githubWorkflowRunMatchesRequestId(run, requestId)) continue;
        const runId = Number(run.id);
        if (!Number.isFinite(runId)) return null;
        if (!isPastArtifactGrace(run, now, graceMs)) return null;

        const artifactsJson = await readJson(
          await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/actions/runs/${runId}/artifacts`,
            { headers: headers(config.token) },
          ),
        );
        const artifacts = Array.isArray(artifactsJson.artifacts)
          ? artifactsJson.artifacts as GithubArtifact[]
          : [];
        if (artifacts.some((artifact) => artifact.name === artifactName)) {
          return null;
        }

        const conclusion = typeof run.conclusion === "string"
          ? run.conclusion
          : null;
        return {
          runId,
          runUrl: run.html_url,
          conclusion,
          message:
            `GitHub Actions ${operationLabel} 실행이 ${
              conclusionLabel(conclusion)
            }로 종료됐고 결과 파일이 생성되지 않았습니다. GitHub 결제 실패·Actions 사용 한도 또는 실행 로그를 확인하세요.`,
        };
      }

      if (runs.length < 100) break;
    }
  } catch {
    // 기존 결과 조회가 일시적으로 실패했을 때는 작업을 중단하지 않는다.
  }
  return null;
}
