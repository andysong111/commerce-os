import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const { fetchShoplingPriceModifyActionsResult } = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingPriceModifyRunner.ts", import.meta.url),
);

const ENV_KEYS = [
  "SHOPLING_PRICE_MODIFY_ENABLED",
  "SHOPLING_PRICE_MODIFY_REPO",
  "SHOPLING_PRICE_MODIFY_WORKFLOW",
  "SHOPLING_PRICE_MODIFY_REF",
  "SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN",
  "GITHUB_ACTIONS_TOKEN",
];

async function withEnv(fn) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    SHOPLING_PRICE_MODIFY_ENABLED: "1",
    SHOPLING_PRICE_MODIFY_REPO: "owner/repo",
    SHOPLING_PRICE_MODIFY_WORKFLOW: "shopling-price-modify.yml",
    SHOPLING_PRICE_MODIFY_REF: "main",
    SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN: "secret-token",
  });
  delete process.env.GITHUB_ACTIONS_TOKEN;
  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const exactRequestId = "price-modify-20260726T161200Z-abcdef";

test("candidate cap still inspects an exact match in the first candidate", async () => withEnv(async () => {
  const exactZip = zipSync({
    "result_summary.json": strToU8(JSON.stringify({ request_id: exactRequestId, status: "success", fail_count: 0 })),
  });
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes("/runs?")) {
      return Response.json({
        workflow_runs: Array.from({ length: 21 }, (_, index) => ({
          id: index + 1,
          status: "completed",
          conclusion: "success",
          html_url: `https://github.test/run/${index + 1}`,
        })),
      });
    }
    if (value.endsWith("/1/artifacts")) {
      return Response.json({ artifacts: [{ name: "shopling-price-modify-result-summary", archive_download_url: "https://download.test/exact.zip" }] });
    }
    if (value === "https://download.test/exact.zip") return new Response(exactZip);
    throw new Error(`unexpected URL ${value}`);
  };
  try {
    const result = await fetchShoplingPriceModifyActionsResult(exactRequestId);
    assert.equal(result.status, "success");
    assert.equal(result.runId, 1);
    assert.equal(calls.filter((value) => value.includes("/artifacts")).length, 1);
    assert.equal(calls.filter((value) => value.endsWith(".zip")).length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
}));

test("candidate cap inspects exactly 20 mismatches and never requests candidate 21", async () => withEnv(async () => {
  const mismatchZip = zipSync({
    "result_summary.json": strToU8(JSON.stringify({ request_id: "price-modify-20260726T161200Z-000000" })),
  });
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.includes("/runs?")) {
      return Response.json({
        workflow_runs: Array.from({ length: 21 }, (_, index) => ({
          id: index + 1,
          status: "completed",
          conclusion: "success",
        })),
      });
    }
    const artifactMatch = value.match(/\/actions\/runs\/(\d+)\/artifacts$/);
    if (artifactMatch) {
      const runId = Number(artifactMatch[1]);
      if (runId === 21) throw new Error("candidate 21 must not be inspected");
      return Response.json({ artifacts: [{ name: "shopling-price-modify-result-summary", archive_download_url: `https://download.test/${runId}.zip` }] });
    }
    if (/https:\/\/download\.test\/\d+\.zip/.test(value)) return new Response(mismatchZip);
    throw new Error(`unexpected URL ${value}`);
  };
  try {
    const result = await fetchShoplingPriceModifyActionsResult(exactRequestId);
    assert.equal(result.status, "pending");
    assert.equal(calls.filter((value) => value.includes("/artifacts")).length, 20);
    assert.equal(calls.filter((value) => value.endsWith(".zip")).length, 20);
    assert.equal(calls.some((value) => value.endsWith("/21/artifacts")), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
}));
