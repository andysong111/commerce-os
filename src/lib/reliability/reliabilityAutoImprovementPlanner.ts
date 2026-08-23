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
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "original_sha", "content"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 500 },
          original_sha: { anyOf: [{ type: "string" }, { type: "null" }] },
          content: { type: "string", minLength: 1, maxLength: 45_000 },
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
  if (!response.ok) throw new Error(`자동수정 대상 파일을 읽지 못했습니다: ${path} (${response.status})`);
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
  if (!Number.isFinite(size) || size > 60_000) {
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
      const content = source.content ?? "<NEW TEST FILE - currently absent>";
      return `\n===== ${source.path} | sha=${source.sha ?? "NEW"} =====\n${content}\n===== END ${source.path} =====`;
    })
    .join("\n");
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
  const sourceByPath = new Map(input.sources.map((source) => [source.path, source]));
  let changedCharacters = 0;
  let changedFiles = 0;
  let hasRegressionTest = false;

  for (const file of input.plan.files) {
    const source = sourceByPath.get(file.path);
    if (!source) throw new Error(`자동수정 원본을 찾지 못했습니다: ${file.path}`);
    if (file.original_sha !== source.sha) {
      throw new Error(`자동수정 원본 버전이 일치하지 않습니다: ${file.path}`);
    }
    const content = String(file.content ?? "");
    if (!content.trim()) throw new Error(`자동수정 결과가 비어 있습니다: ${file.path}`);
    if (content.includes("BEGIN PRIVATE KEY") || /sk-[A-Za-z0-9_-]{20,}/.test(content)) {
      throw new Error("자동수정 결과에 비밀정보처럼 보이는 값이 포함되어 차단했습니다.");
    }
    if (source.content === null && !file.path.endsWith(".test.ts")) {
      throw new Error("자동수정은 새로운 운영 코드 파일을 만들 수 없습니다.");
    }
    const before = source.content ?? "";
    if (before !== content) changedFiles += 1;
    changedCharacters += Math.abs(content.length - before.length) + Math.min(content.length, before.length);
    if (file.path.endsWith(".test.ts") && content.includes("SERVER_FINALIZATION_FAILED")) {
      hasRegressionTest = true;
    }
  }

  if (changedFiles < 1) throw new Error("자동수정 계획이 실제 코드를 바꾸지 않았습니다.");
  if (changedCharacters > surface.maxChangedCharacters) {
    throw new Error("자동수정 변경량이 안전 한도를 넘었습니다.");
  }
  if (!hasRegressionTest) {
    throw new Error("자동수정 계획에 재발 방지 테스트가 포함되지 않았습니다.");
  }

  if (surface.id === "ai_saurus_server_finalization_retry_v1") {
    const route = input.plan.files.find(
      (file) => file.path === "src/app/api/saas/jobs/[jobId]/finalize/route.ts",
    );
    const routeText = route?.content ?? sourceByPath.get(
      "src/app/api/saas/jobs/[jobId]/finalize/route.ts",
    )?.content ?? "";
    for (const invariant of [
      "requireSaasUser(request)",
      "FINALIZER_QUALITY_NOT_READY",
      "FINALIZER_CHECKPOINT_NOT_READY",
      "SAAS_FINAL_GENERATION_ASSET_ROLES",
      "SERVER_FINALIZATION_FAILED",
      'status: "succeeded"',
    ]) {
      if (!routeText.includes(invariant)) {
        throw new Error(`자동수정이 기존 안전장치를 제거하려 해 차단했습니다: ${invariant}`);
      }
    }
  }

  return { ...input.plan, files: input.plan.files.filter((file) => paths.includes(file.path)) };
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
  const instructions = [
    "You are the guarded low-risk code repair planner for Commerce OS.",
    "Return only the strict JSON schema requested by the API.",
    "You may modify only the supplied allowlisted files. Do not request or invent any other path.",
    "Make the smallest reversible change that addresses the confirmed incident.",
    "Preserve authentication, ownership checks, quality gates, durable state, billing, and existing successful behavior.",
    "Do not add dependencies, environment variables, migrations, workflows, secrets, feature flags, or network destinations.",
    "For transient failures, prefer bounded idempotent retry around the narrow failing operation; never retry authentication, validation, or deterministic quality failures.",
    "Every fix must add or strengthen a deterministic regression test in the allowed test file.",
    "Do not claim a root cause beyond the supplied analyzed evidence.",
  ].join("\n");
  const prompt = [
    "LOW-RISK INCIDENT EVIDENCE:",
    jobText(job),
    "\nSAFE SURFACE:",
    JSON.stringify(
      {
        id: surface.id,
        description: surface.userDescription,
        allowed_paths: surface.allowedPaths,
      },
      null,
      2,
    ),
    "\nCURRENT SOURCE FILES:",
    sourceText(sources),
    "\nProduce complete replacement contents only for files that must change. original_sha must exactly match the supplied sha; use null only for the explicitly absent test file.",
  ].join("\n");

  const plan = await requestReliabilityStructuredJson<ReliabilityAutoImprovementPlan>(
    {
      instructions,
      input: prompt,
      schemaName: "reliability_auto_improvement_plan",
      schema: PLAN_SCHEMA,
      initialOutputTokens: 7_000,
      retryOutputTokens: 14_000,
    },
    config,
  );
  return validatePlan({ job, plan, sources });
}
