import { createHash } from "node:crypto";
import {
  hasShoplingInventoryPseudoCategorySegment,
  isShoplingInventoryPseudoCategoryName,
  sanitizeShoplingCategoryPath,
  splitShoplingCategoryPath,
} from "@/lib/shoplingCategoryPathSafety";

type CategoryRow = Record<string, unknown>;
type SnapshotPayload = Record<string, unknown> & {
  categories?: unknown;
  diagnostics?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stringArray(value: unknown, limit = 4) {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).slice(0, limit)
    : [];
}

function sanitizeCategoryRow(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as CategoryRow;
  const originalPath = text(row.path);
  const sanitizedPath = sanitizeShoplingCategoryPath(originalPath);
  if (!sanitizedPath) return null;

  let names = stringArray(row.names);
  if (!names.length) names = splitShoplingCategoryPath(sanitizedPath).slice(0, 4);
  const codes = stringArray(row.codes);

  while (
    names.length &&
    isShoplingInventoryPseudoCategoryName(names.at(-1))
  ) {
    names.pop();
  }

  const pathNames = splitShoplingCategoryPath(sanitizedPath).slice(0, 4);
  if (names.join(">") !== pathNames.join(">")) names = pathNames;

  const depth = Math.min(4, names.length, codes.length);
  if (depth < 1 || depth !== names.length) return null;

  const nextCodes = codes.slice(0, depth);
  const path = names.join(">");
  return {
    ...row,
    depth,
    path,
    names,
    codes: nextCodes,
    largeCode: nextCodes[0] ?? "",
    largeName: names[0] ?? "",
    middleCode: nextCodes[1] ?? "",
    middleName: names[1] ?? "",
    smallCode: nextCodes[2] ?? "",
    smallName: names[2] ?? "",
    detailCode: nextCodes[3] ?? "",
    detailName: names[3] ?? "",
  };
}

export function sanitizeShoplingCategorySnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as SnapshotPayload;
  if (!Array.isArray(source.categories) || !source.categories.length) return null;

  const unique = new Map<string, ReturnType<typeof sanitizeCategoryRow>>();
  let contaminatedRows = 0;
  for (const raw of source.categories) {
    const rawPath =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? text((raw as CategoryRow).path)
        : "";
    if (hasShoplingInventoryPseudoCategorySegment(rawPath)) contaminatedRows += 1;
    const sanitized = sanitizeCategoryRow(raw);
    if (!sanitized) continue;
    unique.set(sanitized.path, sanitized);
  }

  const categories = [...unique.values()]
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => left.path.localeCompare(right.path, "ko-KR"));
  if (!categories.length) return null;

  const canonical = JSON.stringify(
    categories.map((entry) => [entry.path, entry.codes]),
  );
  const hash = createHash("sha256").update(canonical).digest("hex");
  const levelCounts = Object.fromEntries(
    [1, 2, 3, 4].map((depth) => [
      String(depth),
      categories.filter((entry) => Number(entry.depth) === depth).length,
    ]),
  );
  const diagnostics =
    source.diagnostics &&
    typeof source.diagnostics === "object" &&
    !Array.isArray(source.diagnostics)
      ? { ...(source.diagnostics as Record<string, unknown>) }
      : {};

  return {
    ...source,
    categoryCount: categories.length,
    leafCount: categories.length,
    levelCounts,
    hash,
    categories,
    diagnostics: {
      ...diagnostics,
      inventoryPseudoCategoryRowsDetected: contaminatedRows,
      inventoryPseudoCategoryRowsCollapsed: Math.max(
        0,
        source.categories.length - categories.length,
      ),
    },
  };
}
