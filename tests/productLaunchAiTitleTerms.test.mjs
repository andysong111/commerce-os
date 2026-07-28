import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  generateProductLaunchAiTitleTerms,
  parseProductLaunchAiTitleTermInput,
  sanitizeProductLaunchAiTitleTerms,
} from "../src/lib/productLaunchAiTitleTerms.ts";
import { POST as postAiTitleTerms } from "../src/app/api/product-launch-ai-title-terms/route.ts";

const componentPath =
  "src/components/product-launch-flow/ProductLaunchAiTitleTermsPanel.tsx";
const pagePath = "src/app/product-launch-flow/page.tsx";

function input() {
  return {
    goods_key: "121500",
    product_group: "소매1",
    original_title: "여행용 샤워기 필터 헤드",
    current_title_candidates: ["샤워기헤드", "필터헤드"],
    search_keywords: ["여행용샤워기", "샤워기필터"],
    recommendation_keywords: ["휴대용샤워기", "교체형필터"],
  };
}

function generatedTerms() {
  const rows = [
    ["휴대형 샤워헤드", "형태구성", "휴대 사용에 맞는 형태 표현", ["여행용", "샤워기"]],
    ["여행용 필터헤드", "사용상황", "여행 상황을 강조", ["여행용", "필터"]],
    ["교체형 샤워필터", "형태구성", "교체형 필터 구성을 표현", ["교체형필터", "샤워기"]],
    ["휴대용 필터헤드", "사용상황", "휴대 상황과 필터 구성을 결합", ["휴대용샤워기", "필터"]],
    ["샤워 필터헤드", "상품대체어", "상품 정체성을 자연스럽게 표현", ["샤워기", "필터"]],
    ["여행 샤워헤드", "사용상황", "여행용 제품임을 간결하게 표현", ["여행용", "샤워기"]],
    ["필터형 샤워헤드", "형태구성", "필터형 구성을 강조", ["필터", "샤워기"]],
    ["휴대 샤워필터", "사용상황", "휴대 사용에 맞는 짧은 표현", ["휴대용샤워기", "필터"]],
    ["교체 필터헤드", "형태구성", "교체형 필터 구성을 간결하게 표현", ["교체형필터", "헤드"]],
    ["여행 필터샤워기", "사용상황", "여행과 필터 기능의 상품 정체성", ["여행용", "필터", "샤워기"]],
    ["휴대형 필터샤워", "중립수식어", "휴대형 상품명 조합용 표현", ["휴대용샤워기", "필터"]],
    ["샤워헤드 필터형", "스타일", "마켓별 어순 다양화에 적합", ["샤워기", "필터"]],
  ];
  return rows.map(([text, category, reason, evidence]) => ({
    text,
    category,
    reason,
    evidence,
  }));
}

test("AI title term input is strict and bounded", () => {
  const parsed = parseProductLaunchAiTitleTermInput(input());
  assert.equal(parsed.goodsKey, "121500");
  assert.equal(parsed.originalTitle, "여행용 샤워기 필터 헤드");
  assert.deepEqual(parsed.currentTitleCandidates, ["샤워기헤드", "필터헤드"]);
  assert.throws(
    () => parseProductLaunchAiTitleTermInput({ ...input(), goods_key: "bad" }),
    /goods_key/,
  );
  assert.throws(
    () => parseProductLaunchAiTitleTermInput({ ...input(), original_title: "" }),
    /기존 상품명/,
  );
});

test("sanitizer removes claims, duplicates, existing terms and unsupported evidence", () => {
  const parsed = parseProductLaunchAiTitleTermInput(input());
  const result = sanitizeProductLaunchAiTitleTerms(
    [
      ...generatedTerms(),
      {
        text: "완벽한 샤워기",
        category: "중립수식어",
        reason: "과장",
        evidence: ["샤워기"],
      },
      {
        text: "샤워기헤드",
        category: "상품대체어",
        reason: "기존 중복",
        evidence: ["샤워기"],
      },
      {
        text: "무관한 자동차용품",
        category: "사용상황",
        reason: "무관",
        evidence: ["자동차"],
      },
      generatedTerms()[0],
    ],
    parsed,
  );
  assert.equal(result.terms.some((term) => /완벽/.test(term.text)), false);
  assert.equal(result.terms.some((term) => term.text === "샤워기헤드"), false);
  assert.equal(result.terms.some((term) => /자동차/.test(term.text)), false);
  assert.equal(
    result.terms.filter((term) => term.text === "휴대형 샤워헤드").length,
    1,
  );
  assert.ok(result.rejectedCount >= 4);
});

test("generator uses Responses API structured output and returns sanitized terms", async () => {
  let capturedUrl = "";
  let capturedInit;
  const result = await generateProductLaunchAiTitleTerms(input(), {
    apiKey: "test-key",
    model: "gpt-5-mini",
    fetcher: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({ terms: generatedTerms() }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  assert.equal(capturedInit.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.model, "gpt-5-mini");
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(result.status, "success");
  assert.ok(result.terms.length >= 10);
  assert.equal(result.terms.some((term) => term.text === "샤워기헤드"), false);
});

test("API route fails safely when OpenAI key is missing", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await postAiTitleTerms(
      new Request("http://localhost/api/product-launch-ai-title-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input()),
      }),
    );
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.status, "error");
    assert.match(body.message, /OPENAI_API_KEY/);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("product launch page exposes AI title terms before the main flow", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /ProductLaunchAiTitleTermsPanel/);
  assert.ok(
    page.indexOf("ProductLaunchAiTitleTermsPanel") <
      page.indexOf("ProductLaunchFlowSimple"),
  );
});

test("AI title term panel generates, toggles and persists without Shopling writes", async () => {
  const source = await readFile(componentPath, "utf8");
  assert.match(source, /AI 생성어 만들기/);
  assert.match(source, /AI 생성어 다시 만들기/);
  assert.match(source, /\/api\/product-launch-ai-title-terms/);
  assert.match(source, /toggleTerm/);
  assert.match(source, /setReactInputValue/);
  assert.match(source, /PRODUCT_LAUNCH_SIMPLE_SESSION_KEY/);
  assert.match(source, /100bytes/);
  assert.match(source, /다시 누르면 제거/);
  assert.doesNotMatch(source, /shopling.*modify|market.*dispatch/i);
});
