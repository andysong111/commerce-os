import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

const SAFE_SURFACES = {
  ai_saurus_server_finalization_retry_v1: {
    repository: "andysong111/commerce-os-detail-page-saas",
    allowedPaths: [
      "src/app/api/saas/jobs/[jobId]/finalize/route.ts",
      "src/lib/saasServerFinalizer.ts",
      "src/lib/saasServerFinalizerRetry.test.ts",
    ],
    requiredTest: "src/lib/saasServerFinalizerRetry.test.ts",
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
  console.error(message);
  process.exit(1);
}

function readClaim(path) {
  const payload = JSON.parse(readFileSync(path, "utf8"));
  if (payload?.ok !== true) fail(payload?.message || "자동개선 작업 요청이 실패했습니다.");
  return payload;
}

function appendOutput(key, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) fail("GITHUB_OUTPUT이 없습니다.");
  appendFileSync(output, `${key}=${String(value).replaceAll("\n", " ")}\n`, "utf8");
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function forbidden(path) {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return FORBIDDEN.some((part) => normalized.includes(part));
}

function inspect(claimPath) {
  const payload = readClaim(claimPath);
  if (!payload.job) {
    appendOutput("has_job", "false");
    return;
  }
  const job = payload.job;
  const repository = String(process.env.GITHUB_REPOSITORY ?? "");
  if (job.target_repo !== repository) fail("현재 저장소와 자동개선 대상 저장소가 다릅니다.");
  const surface = SAFE_SURFACES[job.safe_surface];
  if (!surface || surface.repository !== repository) {
    fail("이 저장소에 등록되지 않은 자동수정 안전구역입니다.");
  }
  appendOutput("has_job", "true");
  appendOutput("job_id", job.id);
  appendOutput("lease_token", job.lease_token);
  appendOutput("safe_surface", job.safe_surface);
  appendOutput("test_path", surface.requiredTest);
  appendOutput("summary", job.user_summary || "저위험 자동개선");
}

function apply(claimPath) {
  const payload = readClaim(claimPath);
  const job = payload.job;
  if (!job) fail("적용할 자동개선 작업이 없습니다.");
  const repository = String(process.env.GITHUB_REPOSITORY ?? "");
  const surface = SAFE_SURFACES[job.safe_surface];
  if (!surface || surface.repository !== repository || job.target_repo !== repository) {
    fail("자동수정 안전구역 검증에 실패했습니다.");
  }
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
      if (exists || !path.endsWith(".test.ts")) {
        fail(`새 파일 생성 조건이 올바르지 않습니다: ${path}`);
      }
    } else {
      if (!exists) fail(`자동수정 원본 파일이 없습니다: ${path}`);
      const actualSha = git("hash-object", path);
      if (actualSha !== expectedSha) {
        fail(`자동수정 원본 버전이 바뀌어 안전하게 중단했습니다: ${path}`);
      }
    }
    const content = String(file.content ?? "");
    if (!content.trim()) fail(`자동수정 결과가 비어 있습니다: ${path}`);
    if (content.includes("BEGIN PRIVATE KEY") || /sk-[A-Za-z0-9_-]{20,}/.test(content)) {
      fail("자동수정 결과에 비밀정보처럼 보이는 값이 있어 차단했습니다.");
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }

  const status = git("status", "--porcelain");
  const changed = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""));
  if (!changed.length || changed.length > 3) fail("실제 변경 파일 수가 안전 범위를 벗어났습니다.");
  for (const path of changed) {
    if (!serverAllowed.has(path) || !localAllowed.has(path) || forbidden(path)) {
      fail(`계획에 없던 파일 변경을 감지했습니다: ${path}`);
    }
  }
  if (!changed.includes(surface.requiredTest)) {
    fail("재발 방지 테스트가 실제 변경에 포함되지 않았습니다.");
  }
  execFileSync("git", ["diff", "--check"], { stdio: "inherit" });
  writeFileSync("/tmp/reliability-auto-improvement-changed.json", JSON.stringify(changed), "utf8");
  console.log(`Guarded auto-improvement changed: ${changed.join(", ")}`);
}

const [command, claimPath = "/tmp/reliability-claim.json"] = process.argv.slice(2);
if (command === "inspect") inspect(claimPath);
else if (command === "apply") apply(claimPath);
else fail("사용법: node scripts/reliability-auto-improvement-worker.mjs <inspect|apply> <claim.json>");
