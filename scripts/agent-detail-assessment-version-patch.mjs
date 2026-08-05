import { readFileSync, writeFileSync } from "node:fs";

const sourcePath = "src/lib/detailPageAiReview.ts";
const source = readFileSync(sourcePath, "utf8");
const before = '  return assessment.assessment_version === "full_generated_asset_identity_v1";';
const after = '  return /^full_generated_asset_identity_v\\d+$/.test(\n    text(assessment.assessment_version),\n  );';
if (!source.includes(before)) throw new Error("assessment version condition not found");
writeFileSync(sourcePath, source.replace(before, after));

const testPath = "tests/detailPageAiReview.test.mjs";
let tests = readFileSync(testPath, "utf8");
const marker = '\ntest("dashboard exposes a dedicated internal detail-page AI review card", () => {';
const inserted = `\ntest("full asset review recognizes every versioned Studio assessment", () => {\n  for (const version of [\n    "full_generated_asset_identity_v1",\n    "full_generated_asset_identity_v2",\n    "full_generated_asset_identity_v3",\n  ]) {\n    assert.equal(\n      hasFullAssetDetailPageAssessment(\n        job({\n          result: {\n            ...job().result,\n            setAssessment: {\n              ...job().result.setAssessment,\n              assessment_version: version,\n            },\n          },\n        }),\n      ),\n      true,\n    );\n  }\n  assert.equal(\n    hasFullAssetDetailPageAssessment(\n      job({\n        result: {\n          ...job().result,\n          setAssessment: { assessment_version: "legacy_set_review" },\n        },\n      }),\n    ),\n    false,\n  );\n});\n`;
if (!tests.includes(marker)) throw new Error("test insertion marker not found");
tests = tests.replace(marker, `${inserted}${marker}`);
writeFileSync(testPath, tests);
