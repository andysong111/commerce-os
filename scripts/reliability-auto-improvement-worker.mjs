import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const OPS_BASE_URL = String(
  process.env.OPS_RELIABILITY_BASE_URL ?? "https://commerce-os-ops-center.vercel.app",
).replace(/\/$/, "");
const OIDC_AUDIENCE = "commerce-os-reliability-auto-improvement";
const VALIDATION_WORKFLOW = "reliability-auto-improvement-validate.yml";
const SAFE_SURFACES = {
  ai_saurus_server_finalization_retry_v1: {
    repository: "andysong111/commerce-os-detail-page-saas",
    allowedPaths: [
      "src/app/api/saas/jobs/[jobId]/finalize/route.ts",
      "src/lib/saasServerFinalizer.ts",
      "src/lib/saasServerFinalizerRetry.test.ts",
    ],
    requiredTest: "src/lib/saasServerFinalizerRetry.test.ts",
    testName: "SERVER_FINALIZATION_FAILED 재발 방지 자동검증",
  },
};
const FORBIDDEN = [
  ".github/",
  "supabase/migrations/",
  "vercel.json",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "/auth/",
  "billing",
  "payment",
  "refund",
  "paddle",
  "lemon",
  "credit",
  "secret",
  "permission",
  "inventory",
  "price-adjust",
  "order-write",
];

function fail(message) {
  throw new Error(message);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function repository() {
  const value = String(process.env.GITHUB_REPOSITORY ?? "").trim();
  if (!value) fail("GITHUB_REPOSITORY가 없습니다.");
  return value;
}

function githubToken() {
  const token = String(process.env.GITHUB_TOKEN ?? "").trim();
  if (!token) fail("GitHub 자동개선 토큰이 없습니다.");
  return token;
}

function forbidden(path) {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return FORBIDDEN.some((part) => normalized.includes(part));
}

async function getOidcToken() {
  const requestUrl = String(process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "").trim();
  const requestToken = String(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? "").trim();
  if (!requestUrl || !requestToken) fail("GitHub OIDC 실행 권한이 없습니다.");
  const url = new URL(requestUrl);
  url.searchParams.set("audience", OIDC_AUDIENCE);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.value !== "string") {
    fail(`GitHub OIDC 토큰을 받지 못했습니다. (${response.status})`);
  }
  return payload.value;
}

async function opsRequest(path, body) {
  const token = await getOidcToken();
  const response = await fetch(`${OPS_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(125_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    fail(payload?.message || `OPS 자동개선 API 요청 실패 (${response.status})`);
  }
  return payload;
}

async function githubRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${githubToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "commerce-os-reliability-auto-improvement",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`GitHub API ${method} ${path} 실패 (${response.status}): ${payload?.message || "unknown"}`);
  }
  return payload;
}

function validateJob(job) {
  if (!job || job.target_repo !== repository()) fail("현재 저장소와 자동개선 대상 저장소가 다릅니다.");
  const surface = SAFE_SURFACES[job.safe_surface];
  if (!surface || surface.repository !== repository()) {
    fail("이 저장소에 등록되지 않은 자동수정 안전구역입니다.");
  }
  return surface;
}

function applyPlan(job) {
  const surface = validateJob(job);
  const serverAllowed = new Set(Array.isArray(job.allowed_paths) ? job.allowed_paths : []);
  const localAllowed = new Set(surface.allowedPaths);
  const files = Array.isArray(job.plan?.files) ? job.plan.files : [];
  if (!files.length || files.length > 3) fail("자동수정 파일 수가 안전 범위를 벗어났습니다.");

  for (const file of files) {
    const path = String(file.path ?? "").trim();
    if (!serverAllowed.has(path) || !localAllowed.has(path) || forbidden(path)) {
      fail(`자동수정 허용 범위 밖의 파일입니다: ${path}`);
    }
    const expectedSha = file.original_sha == null ? null : String(file.original_sha);
    const exists = existsSync(path);
    if (expectedSha === null) {
      if (exists || !path.endsWith(".test.ts")) fail(`새 파일 생성 조건이 올바르지 않습니다: ${path}`);
    } else {
      if (!exists) fail(`자동수정 원본 파일이 없습니다: ${path}`);
      const actualSha = git("hash-object", path);
      if (actualSha !== expectedSha) fail(`자동수정 원본 버전이 바뀌어 안전하게 중단했습니다: ${path}`);
    }
    const content = String(file.content ?? "");
    if (!content.trim()) fail(`자동수정 결과가 비어 있습니다: ${path}`);
    if (content.includes("BEGIN PRIVATE KEY") || /sk-[A-Za-z0-9_-]{20,}/.test(content)) {
      fail("자동수정 결과에 비밀정보처럼 보이는 값이 있어 차단했습니다.");
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }

  const changed = git("status", "--porcelain")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""));
  if (!changed.length || changed.length > 3) fail("실제 변경 파일 수가 안전 범위를 벗어났습니다.");
  for (const path of changed) {
    if (!serverAllowed.has(path) || !localAllowed.has(path) || forbidden(path)) {
      fail(`계획에 없던 파일 변경을 감지했습니다: ${path}`);
    }
  }
  if (!changed.includes(surface.requiredTest)) fail("재발 방지 테스트가 실제 변경에 포함되지 않았습니다.");
  execFileSync("git", ["diff", "--check"], { stdio: "inherit" });
  return { surface, changed };
}

async function report(job, status, extra = {}) {
  return opsRequest("/api/integrations/reliability/auto-improvement/report", {
    job_id: job.id,
    lease_token: job.lease_token,
    status,
    ...extra,
  });
}

async function createPullRequest(branch, summary, jobId, kind = "repair") {
  const title =
    kind === "revert"
      ? `revert: auto-improvement ${jobId.slice(0, 8)}`
      : `fix: automatic reliability improvement ${jobId.slice(0, 8)}`;
  return githubRequest("/pulls", {
    method: "POST",
    body: {
      title,
      head: branch,
      base: "main",
      body:
        kind === "revert"
          ? `Automated rollback for reliability job ${jobId}. Production verification did not pass, so the generated change is being reverted.`
          : `Guarded low-risk self-improvement.\n\n${summary}\n\n- generated only inside an allowlisted safe surface\n- requires dedicated regression validation\n- requires Vercel Preview success before merge\n- high-risk business writes are not eligible`,
    },
  });
}

async function dispatchValidation(branch) {
  await githubRequest(`/actions/workflows/${VALIDATION_WORKFLOW}/dispatches`, {
    method: "POST",
    body: { ref: branch },
  });
}

async function waitValidation(branch, headSha) {
  let run = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const payload = await githubRequest(
      `/actions/workflows/${VALIDATION_WORKFLOW}/runs?branch=${encodeURIComponent(branch)}&event=workflow_dispatch&per_page=20`,
    );
    run = (payload?.workflow_runs ?? []).find((candidate) => candidate.head_sha === headSha) ?? null;
    if (run?.status === "completed") break;
    await sleep(10_000);
  }
  if (!run || run.status !== "completed") fail("자동개선 전용 검증이 제한 시간 안에 끝나지 않았습니다.");
  if (run.conclusion !== "success") fail(`자동개선 전용 검증 실패: ${run.conclusion || "unknown"}`);
  return run;
}

async function waitVercel(headSha, label) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const payload = await githubRequest(`/commits/${headSha}/status`);
    const statuses = Array.isArray(payload?.statuses) ? payload.statuses : [];
    const vercel = statuses.find((status) => String(status.context).toLowerCase() === "vercel");
    if (vercel?.state === "success") return String(vercel.target_url ?? "");
    if (["failure", "error"].includes(vercel?.state)) fail(`${label} Vercel 검증이 실패했습니다.`);
    await sleep(10_000);
  }
  fail(`${label} Vercel 검증이 제한 시간 안에 완료되지 않았습니다.`);
}

async function mergePullRequest(prNumber, headSha) {
  const payload = await githubRequest(`/pulls/${prNumber}/merge`, {
    method: "PUT",
    body: {
      sha: headSha,
      merge_method: "squash",
      commit_title: `fix: verified automatic reliability improvement (#${prNumber})`,
    },
  });
  if (!payload?.merged || !payload?.sha) fail(payload?.message || "자동개선 PR을 병합하지 못했습니다.");
  return String(payload.sha);
}

async function rollbackMergedChange(job, mergeSha) {
  const branch = `auto/reliability-revert-${job.id.slice(0, 8)}-${process.env.GITHUB_RUN_ID || Date.now()}`;
  git("fetch", "origin", "main");
  git("checkout", "-B", branch, "origin/main");
  git("revert", "--no-edit", mergeSha);
  execFileSync("git", ["diff", "--check", "HEAD^", "HEAD"], { stdio: "inherit" });
  git("push", "origin", `HEAD:refs/heads/${branch}`);
  const headSha = git("rev-parse", "HEAD");
  const pr = await createPullRequest(branch, "", job.id, "revert");
  await dispatchValidation(branch);
  await waitValidation(branch, headSha);
  await waitVercel(headSha, "자동 롤백 미리보기");
  await mergePullRequest(Number(pr.number), headSha);
  return Number(pr.number);
}

async function run() {
  const runId = `${process.env.GITHUB_RUN_ID || "unknown"}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`;
  const claim = await opsRequest("/api/integrations/reliability/auto-improvement/claim", { run_id: runId });
  if (!claim.job) {
    console.log("No eligible low-risk auto-improvement job.");
    return;
  }
  const job = claim.job;
  let stage = "ready";
  try {
    const { surface } = applyPlan(job);
    git("config", "user.name", "commerce-os-reliability-bot");
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
    const branch = `auto/reliability-${job.id.slice(0, 8)}-${process.env.GITHUB_RUN_ID || Date.now()}`;
    git("checkout", "-b", branch);
    git("add", "--", ...surface.allowedPaths);
    git("commit", "-m", `fix: guarded reliability improvement ${job.id.slice(0, 8)}`);
    const headSha = git("rev-parse", "HEAD");
    git("push", "origin", `HEAD:refs/heads/${branch}`);
    const pr = await createPullRequest(branch, String(job.user_summary ?? "저위험 자동개선"), job.id);
    await report(job, "patch_created", {
      branch_name: branch,
      pr_number: Number(pr.number),
      head_sha: headSha,
    });
    stage = "patch_created";

    await report(job, "validating", { pr_number: Number(pr.number), head_sha: headSha });
    stage = "validating";
    await dispatchValidation(branch);
    const validationRun = await waitValidation(branch, headSha);
    const previewUrl = await waitVercel(headSha, "자동개선 미리보기");
    await report(job, "preview_passed", {
      pr_number: Number(pr.number),
      head_sha: headSha,
      preview_url: previewUrl,
      validation: {
        test_path: surface.requiredTest,
        test_name: surface.testName,
        workflow_run_id: validationRun.id,
        workflow_url: validationRun.html_url,
      },
    });
    stage = "preview_passed";

    const mergeSha = await mergePullRequest(Number(pr.number), headSha);
    await report(job, "merged", {
      pr_number: Number(pr.number),
      head_sha: headSha,
      merge_sha: mergeSha,
      preview_url: previewUrl,
    });
    stage = "merged";

    try {
      const productionUrl = await waitVercel(mergeSha, "Production");
      await report(job, "production_verified", {
        pr_number: Number(pr.number),
        head_sha: headSha,
        merge_sha: mergeSha,
        preview_url: previewUrl,
        production_url: productionUrl,
        validation: {
          test_path: surface.requiredTest,
          test_name: surface.testName,
          workflow_run_id: validationRun.id,
          workflow_url: validationRun.html_url,
          preview_url: previewUrl,
        },
      });
      stage = "production_verified";
      console.log(`Automatic reliability improvement deployed: ${mergeSha}`);
    } catch (productionError) {
      console.error(productionError);
      const revertPr = await rollbackMergedChange(job, mergeSha);
      await report(job, "rolled_back", {
        pr_number: revertPr,
        merge_sha: mergeSha,
        error: productionError instanceof Error ? productionError.message : String(productionError),
      });
      stage = "rolled_back";
      console.log("Production verification failed; automatic rollback merged.");
    }
  } catch (error) {
    console.error(error);
    if (!["production_verified", "rolled_back"].includes(stage)) {
      await report(job, "failed", {
        error: error instanceof Error ? error.message : String(error),
      }).catch((reportError) => console.error("Failed to report auto-improvement failure", reportError));
    }
    throw error;
  }
}

const command = process.argv[2] ?? "run";
if (command === "run") {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  console.error("사용법: node scripts/reliability-auto-improvement-worker.mjs run");
  process.exitCode = 1;
}
