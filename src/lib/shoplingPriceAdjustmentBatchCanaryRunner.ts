import { randomBytes } from "node:crypto";
import { unzipSync } from "fflate";

const WORKFLOW_DEFAULT = "shopling-price-adjustment-batch-canary.yml";
const ARTIFACT_NAME = "shopling-price-adjustment-batch-canary-summary";
const SUMMARY_FILENAMES = [
  "price_adjustment_batch_canary_summary.json",
  "output/github_actions/price_adjustment_batch_canary_summary.json",
];
const CONFIRMATION_TEXT = "CONFIRM_TEN_PRICE_ADJUSTMENT_CANARY";
const REQUEST_ID_PATTERN = /^price-adjust-batch-canary-\d{8}T\d{6}Z-[0-9a-f]{6}$/i;
const MAX_ROWS = 10;
const MAX_PAGES = 2;
const MAX_CANDIDATES = 20;

type Config = { repo: string; workflow: string; ref: string; token: string };
type GithubWorkflowRun = { id?: number; status?: string; conclusion?: string | null; html_url?: string };
type GithubArtifact = { name?: string; archive_download_url?: string };

export type ShoplingPriceAdjustmentBatchCanaryInput = {
  goods_key: string;
  adjustment_bps: number;
  expected_current_sell_price: number;
  expected_option_signature: string;
  requires_option_write: boolean;
};

export type ShoplingPriceAdjustmentBatchCanarySummary = {
  schema_version?: unknown;
  source?: unknown;
  run_mode?: unknown;
  status?: unknown;
  exit_code?: unknown;
  request_id?: unknown;
  requested_count?: unknown;
  success_count?: unknown;
  failed_count?: unknown;
  not_executed_count?: unknown;
  fail_stop_used?: unknown;
  automatic_retry_used?: unknown;
  rows?: unknown;
  error?: unknown;
};

export type ShoplingPriceAdjustmentBatchCanaryResult = {
  status: "success" | "pending" | "error";
  message?: string;
  requestId?: string;
  runId?: number;
  runUrl?: string;
  runConclusion?: string | null;
  githubActionsUrl?: string;
  artifactName?: string;
  summary?: ShoplingPriceAdjustmentBatchCanarySummary;
};

function getConfig(): Config {
  const repo = process.env.SHOPLING_PRICE_MODIFY_REPO?.trim();
  const workflow = process.env.SHOPLING_PRICE_ADJUSTMENT_BATCH_CANARY_WORKFLOW?.trim() || WORKFLOW_DEFAULT;
  const ref = process.env.SHOPLING_PRICE_MODIFY_REF?.trim();
  const token = process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN?.trim() || process.env.GITHUB_ACTIONS_TOKEN?.trim();
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("SHOPLING_PRICE_MODIFY_REPO 설정이 필요합니다.");
  if (!workflow || /[\\/]/.test(workflow)) throw new Error("10개 가격 카나리 workflow 설정이 올바르지 않습니다.");
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

export function validateShoplingPriceAdjustmentBatchCanaryInput(value: unknown): ShoplingPriceAdjustmentBatchCanaryInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROWS) {
    throw new Error(`실제 변경 카나리는 1~${MAX_ROWS}개 상품만 사용할 수 있습니다.`);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${index + 1}번째 카나리 입력이 올바르지 않습니다.`);
    const record = item as Record<string, unknown>;
    const allowed = ["goods_key", "adjustment_bps", "expected_current_sell_price", "expected_option_signature", "requires_option_write"];
    if (Object.keys(record).length !== allowed.length || Object.keys(record).some((key) => !allowed.includes(key))) {
      throw new Error(`${index + 1}번째 카나리 입력 필드가 올바르지 않습니다.`);
    }
    const goodsKey = record.goods_key;
    const adjustmentBps = record.adjustment_bps;
    const expectedSell = record.expected_current_sell_price;
    const optionSignature = record.expected_option_signature;
    const requiresOptionWrite = record.requires_option_write;
    if (typeof goodsKey !== "string" || !/^\d+$/.test(goodsKey)) throw new Error(`${index + 1}번째 goods_key는 숫자만 사용할 수 있습니다.`);
    if (seen.has(goodsKey)) throw new Error(`중복 goods_key가 있습니다: ${goodsKey}`);
    if (typeof adjustmentBps !== "number" || !Number.isInteger(adjustmentBps) || adjustmentBps < -9_999 || adjustmentBps > 100_000) {
      throw new Error(`${index + 1}번째 조정률이 허용 범위를 벗어났습니다.`);
    }
    if (typeof expectedSell !== "number" || !Number.isSafeInteger(expectedSell) || expectedSell <= 0) {
      throw new Error(`${index + 1}번째 현재 판매가가 올바르지 않습니다.`);
    }
    if (typeof optionSignature !== "string" || !/^[0-9a-f]{64}$/i.test(optionSignature)) {
      throw new Error(`${index + 1}번째 옵션 서명이 올바르지 않습니다.`);
    }
    if (typeof requiresOptionWrite !== "boolean") throw new Error(`${index + 1}번째 옵션수정 여부가 올바르지 않습니다.`);
    seen.add(goodsKey);
    return {
      goods_key: goodsKey,
      adjustment_bps: adjustmentBps,
      expected_current_sell_price: expectedSell,
      expected_option_signature: optionSignature.toLowerCase(),
      requires_option_write: requiresOptionWrite,
    };
  });
}

export function generateShoplingPriceAdjustmentBatchCanaryRequestId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `price-adjust-batch-canary-${timestamp}-${randomBytes(3).toString("hex")}`;
}

function parseRequestDate(requestId: string) {
  const match = requestId.match(/^price-adjust-batch-canary-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[0-9a-f]{6}$/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const value = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(value.getTime()) ? value : null;
}

export function buildShoplingPriceAdjustmentBatchCanaryDispatch(inputValue: unknown) {
  const input = validateShoplingPriceAdjustmentBatchCanaryInput(inputValue);
  const config = getConfig();
  const [owner, repoName] = config.repo.split("/");
  const requestId = generateShoplingPriceAdjustmentBatchCanaryRequestId();
  return {
    requestId,
    token: config.token,
    githubActionsUrl: `https://github.com/${config.repo}/actions/workflows/${encodeURIComponent(config.workflow)}`,
    url: `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`,
    body: {
      ref: config.ref,
      inputs: {
        batch_canary_json: JSON.stringify(input),
        confirmation_text: CONFIRMATION_TEXT,
        request_id: requestId,
      },
    },
  };
}

export async function dispatchShoplingPriceAdjustmentBatchCanary(inputValue: unknown): Promise<ShoplingPriceAdjustmentBatchCanaryResult> {
  if (process.env.SHOPLING_PRICE_MODIFY_ENABLED !== "1") {
    return { status: "error", message: "SHOPLING_PRICE_MODIFY_ENABLED=1인 경우에만 10개 실제 가격 카나리를 실행할 수 있습니다." };
  }
  let request;
  try { request = buildShoplingPriceAdjustmentBatchCanaryDispatch(inputValue); }
  catch (error) { return { status: "error", message: error instanceof Error ? error.message : "10개 카나리 입력이 올바르지 않습니다." }; }
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: { ...headers(request.token), "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
    if (response.status !== 204 && response.status !== 200) {
      return { status: "error", message: `10개 실제 가격 카나리 요청 실패 status=${response.status}`, requestId: request.requestId, githubActionsUrl: request.githubActionsUrl };
    }
    return { status: "success", message: `${input.length}개 상품의 직렬 실제 가격 카나리를 시작했습니다.`, requestId: request.requestId, githubActionsUrl: request.githubActionsUrl };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "GitHub Actions 요청 중 오류가 발생했습니다.", requestId: request.requestId, githubActionsUrl: request.githubActionsUrl };
  }
}

function findSummaryPath(files: Record<string, Uint8Array>) {
  for (const name of SUMMARY_FILENAMES) if (files[name]) return name;
  return Object.keys(files).find((name) => name.endsWith("/price_adjustment_batch_canary_summary.json"));
}

export function extractShoplingPriceAdjustmentBatchCanarySummary(zipBytes: Uint8Array) {
  const files = unzipSync(zipBytes);
  const path = findSummaryPath(files);
  if (!path) throw new Error("10개 가격 카나리 artifact에서 summary를 찾을 수 없습니다.");
  return JSON.parse(new TextDecoder().decode(files[path])) as ShoplingPriceAdjustmentBatchCanarySummary;
}

export async function fetchShoplingPriceAdjustmentBatchCanaryResult(requestId: string): Promise<ShoplingPriceAdjustmentBatchCanaryResult> {
  if (!REQUEST_ID_PATTERN.test(requestId)) return { status: "error", message: "10개 카나리 요청 추적 ID 형식이 올바르지 않습니다.", requestId };
  let config: Config;
  try { config = getConfig(); }
  catch (error) { return { status: "error", message: error instanceof Error ? error.message : "GitHub 설정이 올바르지 않습니다.", requestId }; }
  const [owner, repoName] = config.repo.split("/");
  const requestDate = parseRequestDate(requestId);
  const created = requestDate ? `${new Date(requestDate.getTime() - 5 * 60_000).toISOString()}..${new Date(requestDate.getTime() + 30 * 60_000).toISOString()}` : undefined;
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
        const summary = extractShoplingPriceAdjustmentBatchCanarySummary(new Uint8Array(await zipResponse.arrayBuffer()));
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
    return { status: "pending", message: "10개 실제 가격 카나리가 아직 완료되지 않았습니다.", requestId };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "10개 카나리 결과 조회 중 오류가 발생했습니다.", requestId };
  }
}
