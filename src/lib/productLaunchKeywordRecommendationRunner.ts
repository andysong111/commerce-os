import { randomBytes } from "node:crypto";
import { getEngineRunnerConfig } from "./engineRunnerConfig";
import { dispatchGitHubActionsWorkflow } from "./githubActionsDispatch";
import {
  downloadWorkflowArtifact,
  extractExpectedArtifactFiles,
} from "./githubActionsArtifacts";
import {
  listWorkflowRunArtifacts,
  listWorkflowRuns,
  type GitHubActionsArtifact,
  type GitHubActionsRun,
} from "./githubActionsRuns";
import {
  parseKeywordRecommendationArtifact,
  type KeywordRecommendationArtifactResult,
} from "./productLaunchKeywordRecommendations";
import { prepareNoSpaceRecommendationArtifactFiles } from "./productLaunchNoSpaceArtifactFiles";

export const KEYWORD_RECOMMENDATION_REQUEST_ID_PATTERN =
  /^keyword-rec-[A-Za-z0-9._:-]{1,100}$/;
export const KEYWORD_RECOMMENDATION_MAX_GOODS_KEYS = 50;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function config() {
  const runner = getEngineRunnerConfig("keyword_engine");
  if (!runner) throw new Error("키워드 엔진 설정을 찾을 수 없습니다.");
  const token = process.env.GITHUB_ENGINE_DISPATCH_TOKEN?.trim();
  if (!token)
    throw new Error("GITHUB_ENGINE_DISPATCH_TOKEN 환경변수가 필요합니다.");
  return { runner, token };
}

export function normalizeKeywordRecommendationGoodsKeys(value: unknown) {
  const raw = Array.isArray(value)
    ? value.map(text)
    : text(value).split(/[\s,]+/).map(text);
  const keys = [...new Set(raw.filter(Boolean))];
  if (keys.length < 1)
    throw new Error("추천키워드를 만들 상품번호가 필요합니다.");
  if (keys.length > KEYWORD_RECOMMENDATION_MAX_GOODS_KEYS) {
    throw new Error(
      `추천키워드 실행은 한 번에 최대 ${KEYWORD_RECOMMENDATION_MAX_GOODS_KEYS}개 상품까지 가능합니다.`,
    );
  }
  for (const key of keys) {
    if (!/^\d+$/.test(key))
      throw new Error(`상품번호 형식이 올바르지 않습니다: ${key}`);
  }
  return keys;
}

export function generateKeywordRecommendationRequestId(now = new Date()) {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `keyword-rec-${timestamp}-${randomBytes(3).toString("hex")}`;
}

export function isValidKeywordRecommendationRequestId(value: string) {
  return KEYWORD_RECOMMENDATION_REQUEST_ID_PATTERN.test(value);
}

export function buildKeywordRecommendationDispatchInput(input: {
  goods_keys?: unknown;
  request_id?: unknown;
}) {
  const goodsKeys = normalizeKeywordRecommendationGoodsKeys(input.goods_keys);
  const requestId =
    text(input.request_id) || generateKeywordRecommendationRequestId();
  if (!isValidKeywordRecommendationRequestId(requestId)) {
    throw new Error("키워드 추천 request_id 형식이 올바르지 않습니다.");
  }
  return {
    goodsKeys,
    requestId,
    workflowInputs: {
      goods_key: goodsKeys.join(","),
      seed_keyword: "",
      request_id: requestId,
      mode: "dry_run",
    },
  };
}

export async function dispatchKeywordRecommendation(input: {
  goods_keys?: unknown;
}) {
  const parsed = buildKeywordRecommendationDispatchInput(input);
  const { runner, token } = config();
  const result = await dispatchGitHubActionsWorkflow({
    owner: runner.repoOwner,
    repo: runner.repoName,
    workflowFile: runner.intendedWorkflowFile,
    ref: "main",
    inputs: parsed.workflowInputs,
    token,
  });
  return {
    status: result.ok ? "queued" : "error",
    phase: result.ok ? "queued" : "failed",
    message: result.ok
      ? "키워드 엔진 추천 생성을 시작했습니다. 결과를 자동으로 확인합니다."
      : result.message,
    requestId: parsed.requestId,
    goodsKeys: parsed.goodsKeys,
    githubActionsUrl: result.actionsUrl,
    runUrl: result.actionsUrl,
  };
}

type RecommendationResultDeps = {
  listRuns: typeof listWorkflowRuns;
  listArtifacts: typeof listWorkflowRunArtifacts;
  downloadArtifact: typeof downloadWorkflowArtifact;
  extractArtifact: typeof extractExpectedArtifactFiles;
};

const DEFAULT_DEPS: RecommendationResultDeps = {
  listRuns: listWorkflowRuns,
  listArtifacts: listWorkflowRunArtifacts,
  downloadArtifact: downloadWorkflowArtifact,
  extractArtifact: extractExpectedArtifactFiles,
};

function pendingResult(
  requestId: string,
  run: GitHubActionsRun | undefined,
  message: string,
) {
  return {
    status: "pending",
    phase:
      run?.status === "queued"
        ? "queued"
        : run?.status === "in_progress"
          ? "running"
          : "waiting_run",
    message,
    requestId,
    runId: run?.id,
    runUrl: run?.htmlUrl,
    runStatus: run?.status,
    runConclusion: run?.conclusion,
  };
}

function failedRunResult(requestId: string, run: GitHubActionsRun) {
  return {
    status: "error",
    phase: "failed",
    message: `키워드 엔진 실행이 성공하지 않았습니다. conclusion=${run.conclusion || "unknown"}`,
    requestId,
    runId: run.id,
    runUrl: run.htmlUrl,
    runStatus: run.status,
    runConclusion: run.conclusion,
  };
}

function exactArtifact(
  artifacts: GitHubActionsArtifact[],
  expectedName: string,
) {
  return artifacts.find(
    (artifact) =>
      artifact.name === expectedName &&
      !artifact.expired &&
      artifact.archiveDownloadUrlAvailable,
  );
}

function exactRun(runs: GitHubActionsRun[], requestId: string) {
  return runs.find(
    (run) =>
      run.event === "workflow_dispatch" &&
      (run.displayTitle.includes(requestId) || run.name.includes(requestId)),
  );
}

function safeRecommendationResult(
  parsed: KeywordRecommendationArtifactResult,
  requestId: string,
  expectedGoodsKeys: string[],
) {
  if (parsed.requestId !== requestId) {
    throw new Error(
      "키워드 추천 artifact의 request_id가 현재 요청과 일치하지 않습니다.",
    );
  }
  if (parsed.missingGoodsKeys.length || parsed.extraGoodsKeys.length) {
    throw new Error(
      `키워드 추천 대상 상품번호가 현재 작업과 일치하지 않습니다. 누락=${parsed.missingGoodsKeys.join(",") || "없음"} 추가=${parsed.extraGoodsKeys.join(",") || "없음"}`,
    );
  }
  if (parsed.groups.length !== expectedGoodsKeys.length) {
    throw new Error("키워드 추천 상품 수가 현재 작업과 일치하지 않습니다.");
  }
  return parsed.groups;
}

export async function fetchKeywordRecommendationResult(
  requestId: string,
  expectedGoodsKeysInput: unknown,
  deps: RecommendationResultDeps = DEFAULT_DEPS,
) {
  if (!isValidKeywordRecommendationRequestId(requestId)) {
    return {
      status: "error",
      phase: "failed",
      message: "키워드 추천 request_id 형식이 올바르지 않습니다.",
      requestId,
    };
  }
  let expectedGoodsKeys: string[];
  try {
    expectedGoodsKeys = normalizeKeywordRecommendationGoodsKeys(
      expectedGoodsKeysInput,
    );
  } catch (error) {
    return {
      status: "error",
      phase: "failed",
      message:
        error instanceof Error
          ? error.message
          : "추천 대상 상품번호가 올바르지 않습니다.",
      requestId,
    };
  }
  try {
    const { runner, token } = config();
    const runs = await deps.listRuns({ ...runner, token, perPage: 30 });
    const run = exactRun(runs, requestId);
    if (!run) {
      return pendingResult(
        requestId,
        undefined,
        "GitHub Actions 실행이 아직 목록에 나타나지 않았습니다. 잠시 후 다시 확인합니다.",
      );
    }
    if (run.status !== "completed") {
      return pendingResult(
        requestId,
        run,
        "키워드 엔진이 추천키워드를 생성하고 있습니다.",
      );
    }
    if (run.conclusion !== "success") {
      return failedRunResult(requestId, run);
    }
    const artifacts = await deps.listArtifacts({ ...runner, token }, run.id);
    const artifact = exactArtifact(artifacts, runner.expectedArtifactName);
    if (!artifact) {
      return pendingResult(
        requestId,
        run,
        "키워드 엔진 실행은 끝났지만 결과 파일이 아직 준비되지 않았습니다.",
      );
    }
    const zip = await deps.downloadArtifact({ ...runner, token }, artifact.id);
    const extracted = deps.extractArtifact("keyword_engine", zip);
    if (extracted.missingFiles.length > 0) {
      throw new Error(
        `키워드 추천 artifact에 필요한 파일이 없습니다: ${extracted.missingFiles.join(", ")}`,
      );
    }
    if (!extracted.files["keyword_engine_run_meta.json"]) {
      throw new Error(
        "키워드 추천 artifact에 exact request_id 메타파일이 없습니다. 최신 키워드 엔진 실행인지 확인하세요.",
      );
    }
    const prepared = prepareNoSpaceRecommendationArtifactFiles(
      extracted.files,
    );
    const parsed = parseKeywordRecommendationArtifact(
      prepared.files,
      expectedGoodsKeys,
    );
    const recommendations = safeRecommendationResult(
      parsed,
      requestId,
      expectedGoodsKeys,
    );
    return {
      status: "success",
      phase: "artifact_ready",
      message: "키워드 엔진 추천 결과를 불러왔습니다.",
      requestId,
      runId: run.id,
      runUrl: run.htmlUrl,
      runStatus: run.status,
      runConclusion: run.conclusion,
      artifactId: artifact.id,
      engineStatus: parsed.status,
      goodsKeys: parsed.goodsKeys,
      noSpacePolicyExcludedCount: prepared.excludedCount,
      recommendations,
    };
  } catch (error) {
    return {
      status: "error",
      phase: "failed",
      message:
        error instanceof Error
          ? error.message
          : "키워드 추천 결과를 가져오는 중 오류가 발생했습니다.",
      requestId,
    };
  }
}
