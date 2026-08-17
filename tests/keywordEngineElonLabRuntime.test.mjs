import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile("src/app/api/keyword-engine-elon-lab/route.ts", "utf8");
const server = await readFile("src/lib/keywordEngineElonLabV2Server.ts", "utf8");
const searchAd = await readFile("src/lib/keywordEngineElonLabV2SearchAd.ts", "utf8");
const browserImport = await readFile("src/lib/keywordEngineElonLabBrowserImport.ts", "utf8");
const page = await readFile("src/app/keyword-engine-elon-lab/page.tsx", "utf8");

test("V2 has no Shopling or Supabase write dependency", () => {
  assert.doesNotMatch(route, /Shopling|Supabase|keywordEngineElonLabStore|keywordEngineElonLabShopling/);
  assert.doesNotMatch(page, /review_stage_batch|run_stage_one|goods_key/);
});

test("browser collection is primary and server scraping remains an explicit fallback", () => {
  assert.match(page, /SaaS 방식 자동수집/);
  assert.match(page, /브라우저 수집이 안 될 때만 서버 보조수집 사용/);
  assert.match(page, /buildKeywordElonBrowserImportUrl/);
  assert.match(page, /parseKeywordElonBrowserImportHash/);
  assert.match(browserImport, /keywordElonSourceFromBrowserPayload/);
  assert.match(server, /collectKeywordElon1688Source/);
});

test("browser payload carries rendered product name and structured option groups without image data", () => {
  assert.match(browserImport, /productName/);
  assert.match(browserImport, /supplierOptionGroups/);
  assert.match(browserImport, /supplierOptions/);
  assert.doesNotMatch(browserImport, /base64.*image|imageCandidates|image_index/i);
});

test("server 1688 collection still fails soft for emergency manual continuation", () => {
  assert.match(server, /validate1688Url/);
  assert.match(server, /자동 수집 실패/);
  assert.match(server, /중국 상품명과 옵션명을 직접 붙여넣으면 STEP 1을 계속할 수 있습니다/);
  assert.match(page, /서버 보조수집/);
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
