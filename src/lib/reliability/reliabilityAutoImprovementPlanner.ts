import {
  getReliabilityAutoImprovementSurface,
  validateReliabilityAutoImprovementPaths,
} from "@/lib/reliability/reliabilityAutoImprovementPolicy";
import {
  reliabilityOpenAiConfiguration,
  requestReliabilityStructuredJson,
} from "@/lib/reliability/reliabilityOpenAiClient";
import type { ReliabilityAutoImprovementJob } from "@/lib/reliability/reliabilityAutoImprovementStore";

export type ReliabilityAutoImprovementPlanFile = {
  path: string;
  original_sha: string | null;
  content: string;
};

export type ReliabilityAutoImprovementPlan = {
  summary: string;
  rationale: string;
  test_intent: string;
  files: ReliabilityAutoImprovementPlanFile[];
};

type GitHubSource = {
  path: string;
  sha: string | null;
  content: string | null;
};

type FinalizationRetryPolicy = {
  version: 1;
  maxAttempts: number;
  delayMs: number;
};

const POLICY_PATH = "src/config/saasServerFinalizationRetryPolicy.json";
const TEST_PATH = "src/lib/saasServerFinalizerRetry.test.ts";

const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "rationale", "test_intent", "files"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 800 },
    rationale: { type: "string", minLength: 1, maxLength: 2_000 },
    test_intent: { type: "string", minLength: 1, maxLength: 1_200 },
    files: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "original_sha", "content"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 500 },
          original_sha: { anyOf: [{ type: "string" }, { type: "null" }] },
          content: { type: "string", minLength: 1, maxLength: 20_000 },
        },
      },
    },
  },
};

function encodeRepositoryPath(path: string) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

async function fetchGitHubSource(repository: string, path: string): Promise<GitHubSource> {
  const url = `https://api.github.com/repos/${repository}/contents/${encodeRepositoryPath(path)}?ref=main`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "commerce-os-reliability-auto-improvement",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return { path, sha: null, content: null };
  if (!response.ok) {
    throw new Error(`자동수정 대상 파일을 읽지 못했습니다: ${path} (${response.status})`);
  }
  const payload = (await response.json()) as {
    type?: unknown;
    sha?: unknown;
    content?: unknown;
    encoding?: unknown;
    size?: unknown;
  };
  if (payload.type !== "file" || payload.encoding !== "base64") {
    throw new Error(`자동수정 대상이 일반 파일이 아닙니다: ${path}`);
  }
  const size = Number(payload.size ?? 0);
  if (!Number.isFinite(size) || size > 30_000) {
    throw new Error(`자동수정 대상 파일이 안전 크기를 넘었습니다: ${path}`);
  }
  return {
    path,
    sha: String(payload.sha ?? "") || null,
    content: Buffer.from(String(payload.content ?? ""), "base64").toString("utf8"),
  };
}

function jobText(job: ReliabilityAutoImprovementJob) {
  const improvement = job.improvement;
  return JSON.stringify(
    {
      source_system: job.source_system,
      engine: job.engine,
      error_code: job.error_code,
      risk_level: job.risk_level,
      safe_action: improvement.safe_action ?? null,
      fact_summary: improvement.fact_summary ?? "",
      root_cause: improvement.root_cause ?? "",
      change_summary: improvement.change_summary ?? "",
      prevention_rule: improvement.prevention_rule ?? "",
      expected_effect: improvement.expected_effect ?? "",
      confidence: improvement.confidence ?? 0,
    },
    null,
    2,
  );
}

function sourceText(sources: GitHubSource[]) {
  return sources
    .map((source) => {
      const content = source.content ?? "<MISSING - AUTOMATIC CHANGE MUST STOP>";
      return `\n===== ${source.path} | sha=${source.sha ?? "MISSING"} =====\n${content}\n===== END ${source.path} =====`;
    })
    .join("\n");
}

function parseRetryPolicy(content: string, label: string): FinalizationRetryPolicy {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`${label} 재시도 정책 JSON을 읽지 못했습니다.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 재시도 정책 형식이 올바르지 않습니다.`);
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  const expectedKeys = ["delayMs", "maxAttempts", "version"];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${label} 재시도 정책은 version, maxAttempts, delayMs만 가질 수 있습니다.`);
  }
  const version = Number(object.version);
  const maxAttempts = Number(object.maxAttempts);
  const delayMs = Number(object.delayMs);
  if (version !== 1) throw new Error(`${label} 재시도 정책 버전은 1이어야 합니다.`);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error(`${label} 재시도 횟수는 1~3회 정수여야 합니다.`);
  }
  if (!Number.isInteger(delayMs) || delayMs < 100 || delayMs > 1_500) {
    throw new Error(`${label} 재시도 간격은 100~1500ms 정수여야 합니다.`);
  }
  return { version: 1, maxAttempts, delayMs };
}

function validateFinalizationRetryPlan(input: {
  plan: ReliabilityAutoImprovementPlan;
  sourceByPath: Map<string, GitHubSource>;
}) {
  const policyFile = input.plan.files.find((file) => file.path === POLICY_PATH);
  const testFile = input.plan.files.find((file) => file.path === TEST_PATH);
  if (!policyFile || !testFile || input.plan.files.length !== 2) {
    throw new Error("자동수정은 재시도 정책과 재발방지 테스트 두 파일만 함께 바꿀 수 있습니다.");
  }

  const policySource = input.sourceByPath.get(POLICY_PATH);
  const testSource = input.sourceByPath.get(TEST_PATH);
  if (!policySource?.content || !policySource.sha || !testSource?.content || !testSource.sha) {
    throw new Error("자동수정 기반 코드가 아직 운영 main에 설치되지 않아 안전하게 중단했습니다.");
  }
  if (policyFile.original_sha !== policySource.sha || testFile.original_sha !== testSource.sha) {
    throw new Error("자동수정 원본 버전이 바뀌어 안전하게 중단했습니다.");
  }
  if (policyFile.content === policySource.content) {
    throw new Error("재시도 정책 값이 실제로 바뀌지 않았습니다.");
  }
  if (testFile.content === testSource.content) {
    throw new Error("재발 방지 테스트가 실제로 바뀌지 않았습니다.");
  }

  const before = parseRetryPolicy(policySource.content, "기존");
  const after = parseRetryPolicy(policyFile.content, "변경 후");
  if (before.maxAttempts >= 3) {
    throw new Error("이미 최대 안전 재시도 횟수에 도달해 자동으로 더 늘릴 수 없습니다.");
  }
  if (after.maxAttempts !== before.maxAttempts + 1) {
    throw new Error("재시도 횟수는 한 번에 정확히 1회만 늘릴 수 있습니다.");
  }
  if (after.delayMs < 100 || after.delayMs > 1_500) {
    throw new Error("재시도 간격이 안전 범위를 벗어났습니다.");
  }

  const testText = testFile.content;
  for (const invariant of [
    "SERVER_FINALIZATION_FAILED",
    "getSaasServerFinalizationRetryPolicy",
    "runSaasServerFinalizationWithRetry",
    `expect(policy.maxAttempts).toBe(${after.maxAttempts})`,
    "toBeLessThanOrEqual(3)",
  ]) {
    if (!testText.includes(invariant)) {
      throw new Error(`재발 방지 테스트의 필수 확인 항목이 빠졌습니다: ${invariant}`);
    }
  }

  return { before, after };
}

function validatePlan(input: {
  job: ReliabilityAutoImprovementJob;
  plan: ReliabilityAutoImprovementPlan;
  sources: GitHubSource[];
}) {
  const surface = getReliabilityAutoImprovementSurface(input.job.safe_surface);
  if (!surface || surface.repository !== input.job.target_repo) {
    throw new Error("자동수정 안전구역을 확인할 수 없습니다.");
  }
  if (!input.plan || !Array.isArray(input.plan.files)) {
    throw new Error("자동수정 계획에 파일 목록이 없습니다.");
  }
  const paths = validateReliabilityAutoImprovementPaths({
    surface,
    paths: input.plan.files.map((file) => file.path),
  });
  if (paths.length !== 2 || !paths.includes(POLICY_PATH) || !paths.includes(TEST_PATH)) {
    throw new Error("등록된 데이터형 재시도 정책과 테스트 이외의 파일은 자동수정할 수 없습니다.");
  }
  const sourceByPath = new Map(input.sources.map((source) => [source.path, source]));
  let changedCharacters = 0;

  for (const file of input.plan.files) {
    const source = sourceByPath.get(file.path);
    if (!source?.content || !source.sha) {
      throw new Error(`자동수정 기반 파일이 운영 main에 없습니다: ${file.path}`);
    }
    if (file.original_sha !== source.sha) {
      throw new Error(`자동수정 원본 버전이 일치하지 않습니다: ${file.path}`);
    }
    const content = String(file.content ?? "");
    if (!content.trim()) throw new Error(`자동수정 결과가 비어 있습니다: ${file.path}`);
    if (content.includes("BEGIN PRIVATE KEY") || /sk-[A-Za-z0-9_-]{20,}/.test(content)) {
      throw new Error("자동수정 결과에 비밀정보처럼 보이는 값이 포함되어 차단했습니다.");
    }
    const before = source.content;
    changedCharacters +=
      Math.abs(content.length - before.length) + Math.min(content.length, before.length);
  }

  if (changedCharacters > surface.maxChangedCharacters) {
    throw new Error("자동수정 변경량이 안전 한도를 넘었습니다.");
  }
  validateFinalizationRetryPlan({ plan: input.plan, sourceByPath });
  return input.plan;
}

export async function planReliabilityAutoImprovement(
  job: ReliabilityAutoImprovementJob,
): Promise<ReliabilityAutoImprovementPlan> {
  if (job.mode !== "auto" || job.risk_level !== "low") {
    throw new Error("저위험 자동수정 작업만 계획할 수 있습니다.");
  }
  const surface = getReliabilityAutoImprovementSurface(job.safe_surface);
  if (!surface || surface.repository !== job.target_repo) {
    throw new Error("등록되지 않은 자동수정 안전구역입니다.");
  }
  const config = reliabilityOpenAiConfiguration();
  if (!config) throw new Error("자동개선 전용 OpenAI 연결이 설정되지 않았습니다.");

  const sources = await Promise.all(
    surface.allowedPaths.map((path) => fetchGitHubSource(surface.repository, path)),
  );
  if (sources.some((source) => !source.content || !source.sha)) {
    throw new Error("자동수정 기반 파일이 아직 대상 저장소 main에 설치되지 않았습니다.");
  }
  const currentPolicySource = sources.find((source) => source.path === POLICY_PATH);
  if (!currentPolicySource?.content) throw new Error("현재 재시도 정책을 찾지 못했습니다.");
  const currentPolicy = parseRetryPolicy(currentPolicySource.content, "현재");
  if (currentPolicy.maxAttempts >= 3) {
    throw new Error("이미 최대 안전 재시도 횟수여서 추가 자동수정을 하지 않습니다.");
  }
  const nextAttempts = currentPolicy.maxAttempts + 1;

  const instructions = [
    "You are the guarded low-risk policy tuner for Commerce OS reliability.",
    "Return only the strict JSON schema requested by the API.",
    `You may modify exactly two files: ${POLICY_PATH} and ${TEST_PATH}.`,
    "You are NOT allowed to edit application code, authentication, database code, workflows, dependencies, secrets, network destinations, or any other path.",
    `Increase maxAttempts by exactly one, from ${currentPolicy.maxAttempts} to ${nextAttempts}; never exceed 3.`,
    "Keep version exactly 1. delayMs must be an integer from 100 through 1500 and should remain conservative unless the evidence clearly supports a small adjustment.",
    "The policy JSON must contain exactly version, maxAttempts, and delayMs with no other keys.",
    `Update the deterministic regression test so it explicitly contains expect(policy.maxAttempts).toBe(${nextAttempts}) and still verifies the <=3 cap.`,
    "Preserve the existing retry helper APIs and test the bounded retry behavior. Do not add imports with side effects or network/database access to the test.",
    "Do not claim a root cause beyond the supplied analyzed evidence.",
  ].join("\n");
  const prompt = [
    "LOW-RISK INCIDENT EVIDENCE:",
    jobText(job),
    "\nCURRENT BOUNDED POLICY:",
    JSON.stringify(currentPolicy, null, 2),
    "\nSAFE DATA-ONLY SURFACE:",
    JSON.stringify(
      {
        id: surface.id,
        description: surface.userDescription,
        allowed_paths: surface.allowedPaths,
        required_next_max_attempts: nextAttempts,
      },
      null,
      2,
    ),
    "\nCURRENT FILES:",
    sourceText(sources),
    "\nReturn complete replacement contents for BOTH files. original_sha must exactly match each supplied sha.",
  ].join("\n");

  const plan = await requestReliabilityStructuredJson<ReliabilityAutoImprovementPlan>(
    {
      instructions,
      input: prompt,
      schemaName: "reliability_auto_improvement_plan",
      schema: PLAN_SCHEMA,
      initialOutputTokens: 5_000,
      retryOutputTokens: 10_000,
    },
    config,
  );
  return validatePlan({ job, plan, sources });
}
