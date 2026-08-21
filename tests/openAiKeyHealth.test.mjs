import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENAI_KEY_HEALTH_LANES,
  probeConfiguredOpenAiKeys,
  probeOpenAiKey,
} from "../src/lib/openAiKeyHealth.ts";

test("OpenAI key health lanes stay mapped to the four production cost keys", () => {
  assert.deepEqual(
    OPENAI_KEY_HEALTH_LANES.map((lane) => lane.envName),
    [
      "KEYWORD_ENGINE_OPENAI_API_KEY",
      "SHOPLING_CATEGORY_OPENAI_API_KEY",
      "PRODUCT_TITLE_OPENAI_API_KEY",
      "OPS_AI_HELP_OPENAI_API_KEY",
    ],
  );
});

test("probe authenticates with the supplied key without returning the secret", async () => {
  let authorization = "";
  const lane = OPENAI_KEY_HEALTH_LANES[0];
  const result = await probeOpenAiKey(lane, "sk-health-secret", async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/models");
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.equal(authorization, "Bearer sk-health-secret");
  assert.equal(result.configured, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.errorCode, null);
  assert.equal(JSON.stringify(result).includes("sk-health-secret"), false);
});

test("missing key fails closed without making a network request", async () => {
  let calls = 0;
  const result = await probeOpenAiKey(
    OPENAI_KEY_HEALTH_LANES[1],
    "",
    async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    },
  );

  assert.equal(calls, 0);
  assert.equal(result.configured, false);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "NOT_CONFIGURED");
});

test("invalid OpenAI credentials return only a safe diagnostic code", async () => {
  const result = await probeOpenAiKey(
    OPENAI_KEY_HEALTH_LANES[2],
    "sk-invalid-secret",
    async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Incorrect API key provided: sk-invalid-secret",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.errorCode, "invalid_api_key");
  assert.equal(JSON.stringify(result).includes("sk-invalid-secret"), false);
});

test("all four environment keys are probed independently", async () => {
  const env = {
    KEYWORD_ENGINE_OPENAI_API_KEY: "sk-keyword",
    SHOPLING_CATEGORY_OPENAI_API_KEY: "sk-category",
    PRODUCT_TITLE_OPENAI_API_KEY: "sk-title",
    OPS_AI_HELP_OPENAI_API_KEY: "sk-help",
  };
  const seen = [];
  const results = await probeConfiguredOpenAiKeys(env, async (_input, init) => {
    seen.push(new Headers(init?.headers).get("authorization"));
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.equal(results.length, 4);
  assert.deepEqual(new Set(seen), new Set([
    "Bearer sk-keyword",
    "Bearer sk-category",
    "Bearer sk-title",
    "Bearer sk-help",
  ]));
  assert.equal(results.every((row) => row.ok), true);
});
