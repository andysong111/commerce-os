import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverUrl = new URL(
  "../src/lib/seoRunJobServer.ts",
  import.meta.url,
);

test("SEO RUN 목록 읽기는 Supabase restart/5xx를 제한 재시도한다", async () => {
  const source = await readFile(serverUrl, "utf8");
  assert.match(source, /const SEO_RUN_READ_ATTEMPTS = 4/);
  assert.match(source, /const SEO_RUN_READ_TIMEOUT_MS = 12_000/);
  assert.match(source, /const SEO_RUN_WRITE_TIMEOUT_MS = 30_000/);
  assert.match(source, /SEO_RUN_READ_RETRY_DELAYS_MS = \[1_500, 3_000, 6_000\]/);
  assert.match(source, /521/);
  assert.match(source, /database system is not accepting connections/);
  assert.match(source, /connection terminated/);
  assert.match(source, /PGRST002/i);
  assert.match(source, /\{ retryRead: true \}/);
});

test("SEO RUN 화면 목록은 무거운 input/checkpoint payload를 전송하지 않는다", async () => {
  const source = await readFile(serverUrl, "utf8");
  const compactStart = source.indexOf("const SEO_RUN_LIST_SELECT");
  const typeStart = source.indexOf("export type SeoRunJobStatus");
  assert.ok(compactStart >= 0 && typeStart > compactStart);
  const compact = source.slice(compactStart, typeStart);
  assert.match(compact, /result_payload/);
  assert.match(compact, /registration_payload/);
  assert.doesNotMatch(compact, /checkpoint_payload/);
  assert.doesNotMatch(compact, /input_payload/);
  assert.match(source, /select: SEO_RUN_LIST_SELECT/);
});

test("읽기만 자동 재시도하고 claim POST는 재전송하지 않으며 checkpoint PATCH는 적용 여부를 재확인한다", async () => {
  const source = await readFile(serverUrl, "utf8");
  assert.match(
    source,
    /options\.retryRead === true && readMethod/,
  );
  const claimStart = source.indexOf("export async function claimNextSeoRunJob");
  const patchStart = source.indexOf("export async function patchClaimedSeoRunJob");
  assert.ok(claimStart >= 0 && patchStart > claimStart);
  const claim = source.slice(claimStart, patchStart);
  assert.match(claim, /method: "POST"/);
  assert.match(claim, /timeoutMs: 15_000/);
  assert.doesNotMatch(claim, /retryRead/);

  const patch = source.slice(patchStart);
  assert.match(patch, /SEO_RUN_PATCH_RECONCILE_ATTEMPTS/);
  assert.match(patch, /readSeoRunJobByIdWithOptions/);
  assert.match(patch, /patchWasApplied/);
  assert.match(patch, /SeoRunLeaseLostError/);
  assert.match(patch, /attempts: 2/);
  assert.match(patch, /timeoutMs: 10_000/);
});
