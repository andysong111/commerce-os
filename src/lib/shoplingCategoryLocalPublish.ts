import { createHash } from "node:crypto";

export type LocalShoplingCategoryEntry = {
  depth: number;
  path: string;
  names: string[];
  codes: string[];
};

export type LocalShoplingCategorySnapshot = {
  schemaVersion: 1;
  source: "shopling_local_playwright";
  status: "success";
  requestId: string;
  collectedAt: string;
  categoryPageUrl: string;
  categoryCount: number;
  leafCount: number;
  levelCounts: Record<string, number>;
  hash: string;
  categories: LocalShoplingCategoryEntry[];
  diagnostics?: Record<string, unknown>;
};

type GitHubRef = { object?: { sha?: unknown } };
type GitHubCommit = { tree?: { sha?: unknown } };
type GitHubObject = { sha?: unknown; message?: unknown };

const DEFAULT_REPO = "andysong111/shopling-product-upload-auto";
const LATEST_PATH = "data/shopling_categories/latest.json";
const STATUS_PATH = "data/shopling_categories/status.json";
const MAX_CATEGORY_COUNT = 50_000;

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function config() {
  const repo = text(
    process.env.SHOPLING_CATEGORY_REPO ||
      process.env.SHOPLING_UPLOAD_REPO ||
      DEFAULT_REPO,
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
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) {
    throw new Error("SHOPLING_CATEGORY_REF 형식이 올바르지 않습니다.");
  }
  if (!token) {
    throw new Error(
      "GITHUB_ACTIONS_TOKEN 또는 GITHUB_ENGINE_DISPATCH_TOKEN이 필요합니다.",
    );
  }
  const [owner, repoName] = repo.split("/");
  return { repo, owner, repoName, ref, token };
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubJson<T>(
  url: string,
  init: RequestInit,
  token: string,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...headers(token), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const raw = await response.text();
  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = text((payload as { message?: unknown }).message) || text(raw);
    const error = new Error(
      message || `GitHub API 요청이 실패했습니다. HTTP ${response.status}`,
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

function normalizeStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean).slice(0, maxItems);
}

export function validateLocalShoplingCategorySnapshot(
  value: unknown,
): LocalShoplingCategorySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("로컬 카테고리 결과 형식이 올바르지 않습니다.");
  }
  const source = value as Record<string, unknown>;
  const requestId = text(source.requestId);
  const collectedAt = text(source.collectedAt);
  const categoryPageUrl = text(source.categoryPageUrl);
  if (!requestId || requestId.length > 160) {
    throw new Error("로컬 카테고리 결과의 requestId가 올바르지 않습니다.");
  }
  const collectedTimestamp = Date.parse(collectedAt);
  if (
    !Number.isFinite(collectedTimestamp) ||
    Math.abs(Date.now() - collectedTimestamp) > 24 * 60 * 60 * 1_000
  ) {
    throw new Error("로컬 카테고리 결과의 수집 시각이 올바르지 않습니다.");
  }
  if (!/^https:\/\/a\.shopling\.co\.kr\//i.test(categoryPageUrl)) {
    throw new Error("샵플링 카테고리 페이지 주소가 올바르지 않습니다.");
  }
  if (!Array.isArray(source.categories)) {
    throw new Error("로컬 카테고리 목록이 없습니다.");
  }
  if (
    source.categories.length <= 0 ||
    source.categories.length > MAX_CATEGORY_COUNT
  ) {
    throw new Error(
      `로컬 카테고리는 1~${MAX_CATEGORY_COUNT.toLocaleString("ko-KR")}개여야 합니다.`,
    );
  }

  const seen = new Set<string>();
  const categories: LocalShoplingCategoryEntry[] = [];
  for (const [index, raw] of source.categories.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${index + 1}번째 카테고리 형식이 올바르지 않습니다.`);
    }
    const row = raw as Record<string, unknown>;
    const path = text(row.path);
    const names = normalizeStringArray(row.names, 4);
    const codes = normalizeStringArray(row.codes, 4);
    const depth = Math.trunc(Number(row.depth) || names.length || codes.length);
    if (!path || path.length > 400 || depth < 1 || depth > 4) {
      throw new Error(`${index + 1}번째 카테고리 경로가 올바르지 않습니다.`);
    }
    if (names.length !== depth || codes.length !== depth) {
      throw new Error(`${index + 1}번째 카테고리 단계 정보가 일치하지 않습니다.`);
    }
    if (path !== names.join(">")) {
      throw new Error(`${index + 1}번째 카테고리 전체 경로가 단계명과 다릅니다.`);
    }
    if (seen.has(path)) continue;
    seen.add(path);
    categories.push({ depth, path, names, codes });
  }
  if (!categories.length) {
    throw new Error("유효한 샵플링 카테고리가 없습니다.");
  }
  categories.sort((left, right) => left.path.localeCompare(right.path, "ko-KR"));
  const levelCounts = Object.fromEntries(
    [1, 2, 3, 4].map((depth) => [
      String(depth),
      categories.filter((entry) => entry.depth === depth).length,
    ]),
  );
  const canonical = JSON.stringify(
    categories.map((entry) => [entry.path, entry.codes]),
  );
  const hash = createHash("sha256").update(canonical).digest("hex");
  return {
    schemaVersion: 1,
    source: "shopling_local_playwright",
    status: "success",
    requestId,
    collectedAt: new Date(collectedTimestamp).toISOString(),
    categoryPageUrl,
    categoryCount: categories.length,
    leafCount: categories.length,
    levelCounts,
    hash,
    categories,
    diagnostics:
      source.diagnostics &&
      typeof source.diagnostics === "object" &&
      !Array.isArray(source.diagnostics)
        ? (source.diagnostics as Record<string, unknown>)
        : {},
  };
}

async function createBlob(
  apiBase: string,
  token: string,
  content: string,
) {
  const result = await githubJson<GitHubObject>(
    `${apiBase}/git/blobs`,
    {
      method: "POST",
      body: JSON.stringify({ content, encoding: "utf-8" }),
    },
    token,
  );
  const sha = text(result.sha);
  if (!sha) throw new Error("GitHub blob SHA를 받지 못했습니다.");
  return sha;
}

export async function publishLocalShoplingCategorySnapshot(value: unknown) {
  const snapshot = validateLocalShoplingCategorySnapshot(value);
  const cfg = config();
  const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repoName}`;
  const latestContent = `${JSON.stringify(snapshot, null, 2)}\n`;
  const status = {
    schemaVersion: 1,
    source: snapshot.source,
    status: "success",
    requestId: snapshot.requestId,
    checkedAt: snapshot.collectedAt,
    categoryPageUrl: snapshot.categoryPageUrl,
    categoryCount: snapshot.categoryCount,
    hash: snapshot.hash,
    message: `샵플링 표준카테고리 ${snapshot.categoryCount.toLocaleString("ko-KR")}개를 로컬 PC에서 업데이트했습니다.`,
  };
  const statusContent = `${JSON.stringify(status, null, 2)}\n`;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const refResult = await githubJson<GitHubRef>(
        `${apiBase}/git/ref/heads/${encodeURIComponent(cfg.ref)}`,
        { method: "GET" },
        cfg.token,
      );
      const parentSha = text(refResult.object?.sha);
      if (!parentSha) throw new Error("GitHub main SHA를 확인하지 못했습니다.");
      const commitResult = await githubJson<GitHubCommit>(
        `${apiBase}/git/commits/${parentSha}`,
        { method: "GET" },
        cfg.token,
      );
      const baseTree = text(commitResult.tree?.sha);
      if (!baseTree) throw new Error("GitHub base tree SHA를 확인하지 못했습니다.");

      const [latestBlob, statusBlob] = await Promise.all([
        createBlob(apiBase, cfg.token, latestContent),
        createBlob(apiBase, cfg.token, statusContent),
      ]);
      const treeResult = await githubJson<GitHubObject>(
        `${apiBase}/git/trees`,
        {
          method: "POST",
          body: JSON.stringify({
            base_tree: baseTree,
            tree: [
              {
                path: LATEST_PATH,
                mode: "100644",
                type: "blob",
                sha: latestBlob,
              },
              {
                path: STATUS_PATH,
                mode: "100644",
                type: "blob",
                sha: statusBlob,
              },
            ],
          }),
        },
        cfg.token,
      );
      const treeSha = text(treeResult.sha);
      if (!treeSha) throw new Error("GitHub category tree SHA를 받지 못했습니다.");
      const newCommit = await githubJson<GitHubObject>(
        `${apiBase}/git/commits`,
        {
          method: "POST",
          body: JSON.stringify({
            message: `Update Shopling category snapshot from local runner [skip ci]`,
            tree: treeSha,
            parents: [parentSha],
          }),
        },
        cfg.token,
      );
      const commitSha = text(newCommit.sha);
      if (!commitSha) throw new Error("GitHub category commit SHA를 받지 못했습니다.");
      await githubJson<GitHubObject>(
        `${apiBase}/git/refs/heads/${encodeURIComponent(cfg.ref)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: commitSha, force: false }),
        },
        cfg.token,
      );
      return {
        snapshot,
        status,
        commitSha,
        repository: cfg.repo,
        ref: cfg.ref,
      };
    } catch (error) {
      lastError = error;
      const statusCode = (error as { status?: number }).status;
      if (statusCode !== 409 && statusCode !== 422) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 350));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("샵플링 카테고리 결과를 GitHub에 저장하지 못했습니다.");
}
