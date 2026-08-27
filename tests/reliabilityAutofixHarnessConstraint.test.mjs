import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  reliabilityAutofixSchema,
  reliabilityAutofixSystemPrompt,
} from "../src/lib/reliability/reliabilityAutofixPolicy.ts";

const ROOT = new URL("../", import.meta.url);

function editPathSchema(schema) {
  return schema.properties.edits.items.properties.path;
}

test("normal autofix generation keeps the existing bounded path schema", () => {
  const path = editPathSchema(reliabilityAutofixSchema());
  assert.equal(path.type, "string");
  assert.equal(path.minLength, 1);
  assert.equal(path.maxLength, 500);
  assert.equal(path.anyOf, undefined);
});

test("alias-harness validator feedback locks test edits to discovered compatible harnesses", () => {
  const feedback = [
    "이전 제안은 호환되지 않습니다.",
    "검증된 기존 실행 하네스 후보: tests/shoplingReadClient.test.mjs, tests/shoplingTlsTransport.test.mjs. 이 중 하나를 보강하고 새 테스트 파일을 만들지 마세요.",
  ].join("\n");
  const path = editPathSchema(reliabilityAutofixSchema(feedback));

  assert.equal(path.anyOf.length, 2);
  assert.equal(path.anyOf[0].pattern, "^src/lib/");
  assert.deepEqual(path.anyOf[1].enum, [
    "tests/shoplingReadClient.test.mjs",
    "tests/shoplingTlsTransport.test.mjs",
  ]);
  assert.equal(path.anyOf[1].enum.includes("tests/shoplingReadClientRetry.test.mjs"), false);
});

test("revision harness extraction drops unsafe paths instead of widening the schema", () => {
  const feedback =
    "검증된 기존 실행 하네스 후보: tests/shoplingReadClient.test.mjs, ../package.json, src/app/unsafe.test.ts. 이 중 하나를 보강하고 새 테스트 파일을 만들지 마세요.";
  const path = editPathSchema(reliabilityAutofixSchema(feedback));

  assert.deepEqual(path.anyOf[1].enum, ["tests/shoplingReadClient.test.mjs"]);
});

test("OpenAI structured output uses the validator-constrained schema on revisions", async () => {
  const openai = await readFile(
    new URL("../src/lib/reliability/reliabilityAutofixOpenAi.ts", import.meta.url),
    "utf8",
  );
  assert.match(openai, /schema: reliabilityAutofixSchema\(revisionFeedback\)/);
  assert.match(
    reliabilityAutofixSystemPrompt(),
    /허용된 기존 실행 하네스 경로.*테스트 edit은 그 경로만 사용/,
  );
});
