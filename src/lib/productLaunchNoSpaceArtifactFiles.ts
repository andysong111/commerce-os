import { parseCsvRows } from "./keywordReviewQueue";
import { isNoSpaceSearchKeyword } from "./productLaunchNoSpaceKeywordPolicy";

const APPROVAL_TERM_FIELDS = [
  "new_site_srch",
  "final_site_srch_safe_for_auto_apply_terms",
  "auto_promoted_site_srch_terms",
  "top_opportunity_keywords",
] as const;

function normalizeHeader(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
}

function splitExactTerms(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  let source: unknown = raw;
  if (
    (raw.startsWith("[") && raw.endsWith("]")) ||
    (raw.startsWith("{") && raw.endsWith("}"))
  ) {
    try {
      source = JSON.parse(raw.replace(/'/g, '"'));
    } catch {
      source = raw;
    }
  }
  const values = Array.isArray(source)
    ? source.map((item) => String(item ?? ""))
    : String(source)
        .replace(/^\[|\]$/g, "")
        .split(/[,，、;|\n]+/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const keyword = value
      .trim()
      .replace(/^[\[\]{}()'"`]+|[\[\]{}()'"`]+$/g, "")
      .trim();
    if (!keyword || !isNoSpaceSearchKeyword(keyword)) continue;
    const identity = keyword.toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(keyword);
  }
  return result;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function serializeCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function appendPipeValue(current: string, value: string) {
  const values = current
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!values.includes(value)) values.push(value);
  return values.join("|");
}

function prepareApprovalCsv(csvText: string) {
  const [headers = [], ...rows] = parseCsvRows(csvText);
  if (!headers.length) return { csv: csvText, excludedCount: 0 };
  const normalized = headers.map(normalizeHeader);
  const indexOf = (field: string) => normalized.indexOf(field);
  let excludedCount = 0;

  const prepared = rows.map((sourceRow) => {
    const row = headers.map((_, index) => sourceRow[index] ?? "");
    let rowExcluded = 0;
    for (const field of APPROVAL_TERM_FIELDS) {
      const index = indexOf(field);
      if (index < 0) continue;
      const originalRaw = row[index] ?? "";
      const originalCount = String(originalRaw)
        .replace(/^\[|\]$/g, "")
        .split(/[,，、;|\n]+/)
        .map((item) => item.trim())
        .filter(Boolean).length;
      const exactTerms = splitExactTerms(originalRaw);
      row[index] = exactTerms.join(",");
      const removed = Math.max(0, originalCount - exactTerms.length);
      rowExcluded += removed;
      excludedCount += removed;
    }

    const finalIndex = indexOf("new_site_srch");
    const finalTerms = finalIndex >= 0 ? splitExactTerms(row[finalIndex]) : [];
    const underfilled = finalTerms.length !== 10;
    if (rowExcluded > 0 || underfilled) {
      for (const field of [
        "site_srch_quality_status",
        "final_site_srch_confidence_status",
        "approval_status",
      ]) {
        const index = indexOf(field);
        if (index >= 0) row[index] = "REVIEW_REQUIRED";
      }
      for (const field of ["apply_ready", "approvable", "review_passed"] ) {
        const index = indexOf(field);
        if (index >= 0) row[index] = "false";
      }
      const countIndex = indexOf("site_srch_keyword_count");
      if (countIndex >= 0) row[countIndex] = String(finalTerms.length);
      const verifiedIndex = indexOf("verified_keyword_count");
      if (verifiedIndex >= 0) {
        row[verifiedIndex] = String(Math.min(finalTerms.length, Number(row[verifiedIndex]) || 0));
      }
      const blockIndex = indexOf("block_reason");
      if (blockIndex >= 0) {
        row[blockIndex] = appendPipeValue(
          row[blockIndex],
          underfilled
            ? "EXACT_NO_SPACE_SITE_SRCH_REVIEW_REQUIRED"
            : "SPACED_SITE_SRCH_EXCLUDED",
        );
      }
      const warningIndex = indexOf("warning_flags");
      if (warningIndex >= 0) {
        row[warningIndex] = appendPipeValue(
          row[warningIndex],
          "OPS_SPACED_KEYWORD_EXCLUDED",
        );
      }
    }
    return row;
  });

  return { csv: serializeCsv([headers, ...prepared]), excludedCount };
}

function filterCandidateRows(csvText: string) {
  const [headers = [], ...rows] = parseCsvRows(csvText);
  if (!headers.length) return { csv: csvText, excludedCount: 0 };
  const normalized = headers.map(normalizeHeader);
  const keywordIndex = normalized.indexOf("candidate_keyword");
  if (keywordIndex < 0) return { csv: csvText, excludedCount: 0 };
  const kept = rows.filter((row) =>
    isNoSpaceSearchKeyword(row[keywordIndex] ?? ""),
  );
  return {
    csv: serializeCsv([headers, ...kept]),
    excludedCount: rows.length - kept.length,
  };
}

export function prepareNoSpaceRecommendationArtifactFiles(
  files: Record<string, string>,
) {
  const approval = prepareApprovalCsv(
    files["keyword_mvp_approval_sheet.csv"] ?? "",
  );
  const manual = filterCandidateRows(
    files["keyword_mvp_manual_candidates.csv"] ?? "",
  );
  const audit = filterCandidateRows(
    files["keyword_mvp_auto_promotion_audit.csv"] ?? "",
  );
  return {
    files: {
      ...files,
      "keyword_mvp_approval_sheet.csv": approval.csv,
      "keyword_mvp_manual_candidates.csv": manual.csv,
      "keyword_mvp_auto_promotion_audit.csv": audit.csv,
    },
    excludedCount:
      approval.excludedCount + manual.excludedCount + audit.excludedCount,
  };
}
