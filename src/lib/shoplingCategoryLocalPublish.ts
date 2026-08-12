import { createHash } from "node:crypto";
import { sanitizeShoplingCategorySnapshot } from "@/lib/shoplingCategorySnapshotSafety";
import { writeShoplingCategoryCatalogToSupabase } from "@/lib/shoplingCategorySupabaseStore";

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

const MAX_CATEGORY_COUNT = 50_000;

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean).slice(0, maxItems);
}

export function validateLocalShoplingCategorySnapshot(
  value: unknown,
): LocalShoplingCategorySnapshot {
  const sanitized = sanitizeShoplingCategorySnapshot(value);
  if (!sanitized) {
    throw new Error("로컬 카테고리 결과 형식이 올바르지 않습니다.");
  }
  const source = sanitized as Record<string, unknown>;
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

export async function publishLocalShoplingCategorySnapshot(value: unknown) {
  const snapshot = validateLocalShoplingCategorySnapshot(value);
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
  } as const;

  await writeShoplingCategoryCatalogToSupabase({ snapshot, status });

  return {
    snapshot,
    status,
    storage: "supabase" as const,
    commitSha: "",
    repository: "",
    ref: "",
  };
}
