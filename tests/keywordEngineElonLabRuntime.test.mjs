import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const route = await readFile("src/app/api/keyword-engine-elon-lab/route.ts", "utf8");
const zipRoute = await readFile("src/app/api/keyword-engine-elon-lab/collector-zip/route.ts", "utf8");
const server = await readFile("src/lib/keywordEngineElonLabV2Server.ts", "utf8");
const searchAd = await readFile("src/lib/keywordEngineElonLabV2SearchAd.ts", "utf8");
const page = await readFile("src/app/keyword-engine-elon-lab/page.tsx", "utf8");
const browserImport = await readFile("src/lib/keywordEngineElonLabBrowserImport.ts", "utf8");
const collector1688Path = "public/keyword-lab-collector/content-1688.js";
const collectorOpsPath = "public/keyword-lab-collector/content-ops.js";
const collector1688 = await readFile(collector1688Path, "utf8");
const collectorOps = await readFile(collectorOpsPath, "utf8");

test("V2 has no Shopling or Supabase write dependency", () => {
  assert.doesNotMatch(route, /Shopling|Supabase|keywordEngineElonLabStore|keywordEngineElonLabShopling/);
  assert.doesNotMatch(page, /review_stage_batch|run_stage_one|goods_key/);
});

test("dedicated collector uses rendered 1688 DOM for title and structured option groups", () => {
  assert.match(collector1688, /extractProductName/);
  assert.match(collector1688, /extractJsonProductNames/);
  assert.match(collector1688, /extractStructuredOptionGroups/);
  assert.match(collector1688, /GROUP_PATTERN/);
  assert.match(collector1688, /supplierOptionGroups/);
  assert.match(collector1688, /commerce_os_keyword_lab_collect/);
  assert.match(collector1688, /commerce_os_keyword_lab_return/);
  assert.doesNotMatch(collector1688, /imageCandidates|fetchAndPrepareImage|AI-Saurus/);
});

test("collector and Lab handoff are independent from the detail-page SaaS", () => {
  assert.match(collector1688, /commerce-os-keyword-lab-collector/);
  assert.match(browserImport, /collectorVersion/);
  assert.match(page, /Keyword Lab Collector/);
  assert.doesNotMatch(page, /AI-Saurus/);
  assert.doesNotMatch(browserImport, /AI-Saurus/);
  assert.doesNotMatch(collector1688, /ai-saurus|detail-page/i);
});

test("collector installer zip contains only the dedicated collector package", () => {
  assert.match(zipRoute, /public\/keyword-lab-collector/);
  assert.match(zipRoute, /manifest\.json/);
  assert.match(zipRoute, /content-1688\.js/);
  assert.match(zipRoute, /content-ops\.js/);
  assert.match(zipRoute, /README\.txt/);
  assert.match(zipRoute, /commerce-os-keyword-lab-collector-v0\.1\.0\.zip/);
});

test("collector exposes its installed version to the Ops Center page", () => {
  assert.match(collectorOps, /commerceOsKeywordLabCollectorVersion/);
  assert.match(collectorOps, /commerce-os-keyword-lab-collector-ready/);
  assert.match(page, /commerceOsKeywordLabCollectorVersion/);
  assert.match(page, /KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION/);
});

test("collector JavaScript is syntactically valid", () => {
  for (const path of [collector1688Path, collectorOpsPath]) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test("server-side 1688 collection remains only a soft fallback", () => {
  assert.match(server, /validate1688Url/);
  assert.match(server, /중국 상품명과 옵션명을 직접 붙여넣으면 STEP 1을 계속할 수 있습니다/);
  assert.match(page, /서버 보조수집/);
  assert.match(page, /기본 수집은 전용 브라우저 수집기를 사용하세요/);
});

test("identity analysis explicitly forbids seller model names", () => {
  assert.match(server, /판매자가 만든 한국 모델명은 절대 사용하지 않는다/);
  assert.match(server, /1688 중국 원본 상품명·옵션·보조텍스트만 근거/);
});

test("SearchAd is optional and does not block discovery", () => {
  assert.match(searchAd, /SEARCHAD_NOT_CONFIGURED/);
  assert.match(searchAd, /SearchAd 자격증명이 없어 검색량·경쟁 데이터는 이번 실행에서 제외/);
  assert.match(server, /Promise\.all/);
});

test("title generation is derived from scored title-eligible keywords and capped at 100 UTF-8 bytes", () => {
  assert.match(server, /qualityScore >= input\.cutoff && row\.titleEligible/);
  assert.match(server, /truncateUtf8\(.*100/);
  assert.match(server, /고득점 titleEligible 키워드를 우선 재료/);
});

test("client shows non-JSON server failures instead of silently breaking", () => {
  assert.match(page, /서버가 JSON이 아닌 응답을 반환했습니다/);
  assert.match(page, /HTTP \$\{response\.status\}/);
});
