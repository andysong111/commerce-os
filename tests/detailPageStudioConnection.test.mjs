import assert from "node:assert/strict";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  buildProtectedOpsCallbackUrl,
  probeDetailPageStudio,
  probeProtectedOpsCallback,
  resolveDetailPageStudioConnection,
} = await importTranspiledTypeScript(
  new URL("../src/lib/detailPageStudioConnection.ts", import.meta.url),
);

const environmentKeys = [
  "VERCEL_ENV",
  "DETAIL_PAGE_STUDIO_INTERNAL_URL",
  "NEXT_PUBLIC_DETAIL_PAGE_STUDIO_INTERNAL_URL",
  "DETAIL_PAGE_STUDIO_AUTOMATION_BYPASS_SECRET",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
];

function withEnvironment(values, run) {
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, values);
  const restore = () => {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
  try {
    const result = run();
    if (result && typeof result.then === "function") {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("preview deployments select the bounded final-assembly Studio Preview", () => {
  withEnvironment({ VERCEL_ENV: "preview" }, () => {
    const connection = resolveDetailPageStudioConnection();
    assert.equal(
      connection.engineOrigin,
      "https://commerce-os-detail-page-studio-git-agent-final-96809d-a2bsangsa.vercel.app",
    );
    assert.equal(connection.isPreview, true);
    assert.deepEqual(connection.requestHeaders, {});
  });
});

test("preview recovery ignores an older persistent Studio URL override", () => {
  withEnvironment(
    {
      VERCEL_ENV: "preview",
      DETAIL_PAGE_STUDIO_INTERNAL_URL:
        "https://commerce-os-detail-page-studio-git-agent-old-preview.vercel.app/",
    },
    () => {
      const connection = resolveDetailPageStudioConnection();
      assert.equal(
        connection.engineOrigin,
        "https://commerce-os-detail-page-studio-git-agent-final-96809d-a2bsangsa.vercel.app",
      );
    },
  );
});

test("Studio protection bypass is carried through browser and recursive worker requests", () => {
  withEnvironment(
    {
      VERCEL_ENV: "preview",
      DETAIL_PAGE_STUDIO_AUTOMATION_BYPASS_SECRET: "studio-test-secret",
    },
    () => {
      const connection = resolveDetailPageStudioConnection();
      assert.equal(
        connection.requestHeaders["x-vercel-protection-bypass"],
        "studio-test-secret",
      );
      assert.equal(
        connection.browserUrl.searchParams.get("x-vercel-set-bypass-cookie"),
        "samesitenone",
      );
      assert.equal(
        connection.workerUrl.searchParams.get("x-vercel-protection-bypass"),
        "studio-test-secret",
      );
    },
  );
});

test("OPS callback URLs carry only the deployment bypass required by the Studio worker", () => {
  withEnvironment(
    { VERCEL_AUTOMATION_BYPASS_SECRET: "ops-test-secret" },
    () => {
      const callback = buildProtectedOpsCallbackUrl(
        "https://ops-preview.example/api/start",
        "/api/product-launch-tracker/detail-page-jobs/00112233-4455-6677-8899-aabbccddeeff",
      );
      assert.equal(callback.origin, "https://ops-preview.example");
      assert.equal(
        callback.searchParams.get("x-vercel-protection-bypass"),
        "ops-test-secret",
      );
      assert.equal([...callback.searchParams].length, 1);
    },
  );
});

test("Studio capability probe rejects a Vercel protection redirect before a paid job is created", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://vercel.com/sso-api" },
    });
  try {
    const result = await withEnvironment({ VERCEL_ENV: "preview" }, () =>
      probeDetailPageStudio(resolveDetailPageStudioConnection()),
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "DETAIL_PAGE_STUDIO_PREVIEW_PROTECTED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Studio capability probe rejects an outdated finalizer before reconnecting", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      ok: true,
      service: "commerce-os-detail-page-studio",
      opsDockVersion: "server-v1",
    });
  try {
    const result = await withEnvironment({ VERCEL_ENV: "preview" }, () =>
      probeDetailPageStudio(resolveDetailPageStudioConnection()),
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "DETAIL_PAGE_STUDIO_INCOMPATIBLE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OPS callback probe verifies its capability response with the local bypass header", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (input, init) => {
    captured = { input: String(input), init };
    return Response.json({ ok: true, opsCallbackVersion: "server-v1" });
  };
  try {
    const result = await withEnvironment(
      { VERCEL_AUTOMATION_BYPASS_SECRET: "ops-test-secret" },
      () => probeProtectedOpsCallback("https://ops-preview.example/api/config"),
    );
    assert.equal(result.ok, true);
    assert.match(captured.input, /detail-page-callback-health/);
    assert.equal(
      captured.init.headers["x-vercel-protection-bypass"],
      "ops-test-secret",
    );
    assert.equal(captured.init.redirect, "manual");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
