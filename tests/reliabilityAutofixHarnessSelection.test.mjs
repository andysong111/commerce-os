import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { looksLikeExecutableTypeScriptHarness } from "../scripts/reliability-autofix-harness.mjs";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, ROOT), "utf8");

test("autofix harness selection accepts the real Shopling transpile/load harness", async () => {
  const harness = await source("tests/shoplingReadClient.test.mjs");
  assert.equal(looksLikeExecutableTypeScriptHarness(harness), true);
});

test("autofix harness selection rejects the reliability meta-test that only discusses the target", async () => {
  const metaTest = await source("tests/reliabilityAutofixRevision.test.mjs");
  assert.equal(looksLikeExecutableTypeScriptHarness(metaTest), false);
});

test("autofix harness selection requires both a trusted loader import and an actual loader call", () => {
  const regexOnly = `assert.match(existingHarness, /transpileModule/);`;
  const callWithoutImport = `const compiled = ts.transpileModule(source, options);`;
  const realCompilerHarness = `
import ts from "typescript";
const compiled = ts.transpileModule(source, options);
`;
  const realHelperHarness = `
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";
const module = await importTranspiledTypeScript(url);
`;

  assert.equal(looksLikeExecutableTypeScriptHarness(regexOnly), false);
  assert.equal(looksLikeExecutableTypeScriptHarness(callWithoutImport), false);
  assert.equal(looksLikeExecutableTypeScriptHarness(realCompilerHarness), true);
  assert.equal(looksLikeExecutableTypeScriptHarness(realHelperHarness), true);
});
