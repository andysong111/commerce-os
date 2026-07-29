import { randomBytes } from "node:crypto";
import { unzipSync } from "fflate";

const WORKFLOW_DEFAULT = "shopling-price-adjustment-plan.yml";
const ARTIFACT_NAME = "shopling-price-adjustment-plan-summary";
const SUMMARY_FILENAMES = [
  "price_adjustment_plan_summary.json",
  "output/github_actions/price_adjustment_plan_summary.json",
];
const MAX_ROWS = 50;
const REQUEST_ID_PATTERN = /^price-adjust-plan-\d{8}T\d{6}Z-[0-9a-f]{6}$/i;
const MAX_PAGES = 2;
const MAX_CANDIDATES = 20;

type Config = { repo: string; workflow: string; ref: string; token: string };
type GithubWorkflowRun = { id?: number; status?: string; conclusion?: string | null; html_url?: string };
type GithubArtifact = { name?: string; archive_download_url?: string };

export type ShoplingPriceAdjustmentPlanInput = {
  goods_key: string;
  adjustment_bps: number;
};

export type ShoplingPriceAdjustmentPlanSummary = {
  schema_version?: unknown;
  source?: unknown;
  run_mode?: unknown;
  status?: unknown;
  exit_code?: unknown;
  request_id?: unknown;
  goods_key_count?: unknown;
  planned_goods_key_count?: unknown;
  failed_goods_key_count?: unknown;
  planned_mall_row_count?: unknown;
  rows?: unknown;
  errors?: unknown;
};

export type ShoplingPriceAdjustmentPlanResult = {
  status: "success" | "pending" | "error";
  message?: string;
  requestId?: string;
  runId?: number;
  runUrl?: string;
  runConclusion?: string | null;
  artifactName?: string;
  summary?: ShoplingPriceAdjustmentPlanSummary;
};

function getConfig(): Config {
  const repo = process.env.SHOPLING_PRICE_MODIFY_REPO?.trim();
  const workflow = process.env.SHOPLING_PRICE_ADJUSTMENT_PLAN_WORKFLOW?.trim() || WORKFLOW_DEFAULT;
  const ref = process.env.SHOPLING_PRICE_MODIFY_REF?.trim();
  const token = process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN?.trim() || process.env.GITHUB_ACTIONS_TOKEN?.trim();
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("SHOPLING_PRICE_MODIFY_REPO 설정이 필요합니다.");
  if (!workflow || /[\\/]/.test(workflow)) throw new Error("가격 인상·인하 계획 workflow 설정이 올바르지 않습니다.");
  if (!ref) throw new Error("SHOPLING_PRICE_MODIFY_REF 설정이 필요합니다.");
  if (!token) throw new Error("SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN 또는 GITHUB_ACTIONS_TOKEN 설정이 필요합니다.");
  return { repo, workflow, ref, token };
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
  if (!response.ok) throw new Error(`GitHub API 요청 실패 status=${response.status}${text ? ` body=${text.slice(0, 300)}` : ""}`);
  return text ? JSON.parse(text) : {};
}

export function validateShoplingPriceAdjustmentPlanRows(value: unknown): ShoplingPriceAdjustmentPlanInput[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("현재 가격을 조회할 상품이 없습니다.");
  if (value.length > MAX_ROWS) throw new Error(`한 번에 최대 ${MAX_ROWS}개 상품의 현재 가격을 조회할 수 있습니다.`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${index + 1}번째 계획 행이 올바르지 않습니다.`);
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["goods_key", "adjustment_bps"].includes(key))) throw new Error(`${index + 1}번째 계획 행에 허용되지 않은 필드가 있습니다.`);
    const goodsKey = record.goods_key;
    const adjustmentBps = record.adjustment_bps;
    if (typeof goodsKey !== "string" || !/^\d+$/.test(goodsKey)) throw new Error(`${index + 1}번째 goods_key는 숫자만 사용할 수 있습니다.`);
    if (seen.has(goodsKey)) throw new Error(`중복 goods_key가 있습니다: ${goodsKey}`);
    if (typeof adjustmentBps !== "number" || !Number.isInteger(adjustmentBps) || adjustmentBps < -9_999 || adjustmentBps > 100_000) {
      throw new Error(`${index + 1}번째 조정률이 허용 범위를 벗어났습니다.`);
    }
    seen.add(goodsKey);
    return { goods_key: goodsKey, adjustment_bps: adjustmentBps };
  });
}

export function generateShoplingPriceAdjustmentPlanRequestId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `price-adjust-plan-${timestamp}-${randomBytes(3).toString("hex")}`;
}

export function parseShoplingPriceAdjustmentPlanRequestDate(requestId: string) {
  const match = requestId.match(/^price-adjust-plan-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[0-9a-f]{6}$/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const value = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(value.getTime()) ? value : null;
}

export function buildShoplingPriceAdjustmentPlanDispatch(rowsInput: unknown) {
  const rows = validateShoplingPriceAdjustmentPlanRows(rowsInput);
  const config = getConfig();
  const [owner, repoName] = config.repo.split("/");
  const requestId = generateShoplingPriceAdjustmentPlanRequestId();
  return {
    requestId,
    token: config.token,
    githubActionsUrl: `https://github.com/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}`,
    url: `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`,
    body: {
      ref: config.ref,
      inputs: {
        adjustment_plan_json: JSON.stringify(rows),
        request_id: requestId,
      },
    },
  };
}

export async function dispatchShoplingPriceAdjustmentPlan(rowsInput: unknown) {
  let request;
  try {
    request = buildShoplingPriceAdjustmentPlanDispatch(rowsInput);
  } catch (error) {
    return { status: "error" as const, message: error instanceof Error ? error.message : "가격 계획 입력이 올바르지 않습니다." };
  }
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: { ...headers(request.token), "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
    if (response.status !== 204 && response.status !== 200) {
      return { status: "error" as const, message: `읽기 전용 가격 계획 실행 요청 실패 status=${response.status}`, requestId: request.requestId, githubActionsUrl: request.githubActionsUrl };
    }
    return { status: "success" as const, message: "현재 가격·옵션 조회 계획 실행을 시작했습니다.", requestId: request.requestId, githubActionsUrl: request.githubActionsUrl };
  } catch (error) {
    return { status: "error" as const, message: error instanceof Error ? error.message : "GitHub Actions 요청 중 오류가 발생했습니다.", requestId: request.requestId, githubActionsUrl: request.githubActionsUrl };
  }
}

function findSummaryPath(files: Record<string, Uint8Array>) {
  for (const name of SUMMARY_FILENAMES) if (files[name]) return name;
  return Object.keys(files).find((name) => name.endsWith("/price_adjustment_plan_summary.json"));
}

export function extractShoplingPriceAdjustmentPlanSummary(zipBytes: Uint8Array) {
  const files = unzipSync(zipBytes);
  const path = findSummaryPath(files);
  if (!path) throw new Error("가격 인상·인하 계획 artifact에서 summary를 찾을 수 없습니다.");
  return JSON.parse(new TextDecoder().decode(files[path])) as ShoplingPriceAdjustmentPlanSummary;
}

export async function fetchShoplingPriceAdjustmentPlanResult(requestId: string): Promise<ShoplingPriceAdjustmentPlanResult> {
  if (!REQUEST_ID_PATTERN.test(requestId)) return { status: "error", message: "요청 추적 ID 형식이 올바르지 않습니다.", requestId };
  let config: Config;
  try { config = getConfig(); }
  catch (error) { return { status: "error", message: error instanceof Error ? error.message : "GitHub 설정이 올바르지 않습니다.", requestId }; }
  const [owner, repoName] = config.repo.split("/");
  const requestDate = parseShoplingPriceAdjustmentPlanRequestDate(requestId);
  const created = requestDate ? `${new Date(requestDate.getTime() - 5 * 60_000).toISOString()}..${new Date(requestDate.getTime() + 15 * 60_000).toISOString()}` : undefined;
  let candidates = 0;
  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const params = new URLSearchParams({ branch: config.ref, event: "workflow_dispatch", status: "completed", per_page: "100", page: String(page) });
      if (created) params.set("created", created);
      const runsUrl = `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/runs?${params.toString()}`;
      const runsJson = await readJson(await fetch(runsUrl, { headers: headers(config.token) }));
      const runs = Array.isArray(runsJson.workflow_runs) ? runsJson.workflow_runs as GithubWorkflowRun[] : [];
      for (const run of runs) {
        if (candidates >= MAX_CANDIDATES) return { status: "pending", message: "완료 실행 후보 안전 조회 한도에 도달했습니다. 잠시 후 다시 확인하세요.", requestId };
        const runId = Number(run.id);
        if (!Number.isFinite(runId)) continue;
        candidates += 1;
        const artifactsJson = await readJson(await fetch(`https://api.github.com/repos/${owner}/${repoName}/actions/runs/${runId}/artifacts`, { headers: headers(config.token) }));
        const artifact = (Array.isArray(artifactsJson.artifacts) ? artifactsJson.artifacts as GithubArtifact[] : []).find((item) => item.name === ARTIFACT_NAME);
        if (!artifact?.archive_download_url) continue;
        const zipResponse = await fetch(artifact.archive_download_url, { headers: headers(config.token) });
        if (!zipResponse.ok) continue;
        const summary = extractShoplingPriceAdjustmentPlanSummary(new Uint8Array(await zipResponse.arrayBuffer()));
        if (summary.request_id !== requestId) continue;
        return {
          status: "success",
          requestId,
          runId,
          runUrl: run.html_url,
          runConclusion: typeof run.conclusion === "string" ? run.conclusion : null,
          artifactName: ARTIFACT_NAME,
          summary,
        };
      }
      if (runs.length < 100) break;
    }
    return { status: "pending", message: "현재 가격·옵션 조회가 아직 완료되지 않았습니다.", requestId };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "계획 결과 조회 중 오류가 발생했습니다.", requestId };
  }
}
