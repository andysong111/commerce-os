import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const operatorRoutes = [
  "src/app/api/shopling-price-adjustment/batch-canary/result/route.ts",
  "src/app/api/shopling-price-adjustment/batch-canary/run/route.ts",
  "src/app/api/shopling-price-adjustment/canary/result/route.ts",
  "src/app/api/shopling-price-adjustment/canary/run/route.ts",
  "src/app/api/shopling-price-adjustment/option-canary/result/route.ts",
  "src/app/api/shopling-price-adjustment/option-canary/run/route.ts",
  "src/app/api/shopling-price-adjustment/plan/result/route.ts",
  "src/app/api/shopling-price-adjustment/plan/run/route.ts",
];

const adminRoutes = [
  "src/app/api/shopling-price-adjustment/bulk/jobs/route.ts",
  "src/app/api/shopling-price-adjustment/bulk/jobs/[jobId]/advance/route.ts",
  "src/app/api/shopling-price-adjustment/bulk/jobs/[jobId]/pause/route.ts",
  "src/app/api/shopling-price-adjustment/bulk/jobs/[jobId]/route.ts",
  "src/app/api/shopling-price-adjustment/bulk/jobs/[jobId]/start/route.ts",
];

const clientComponents = [
  "src/components/shopling-price-adjustment/ShoplingPriceAdjustmentBatchCanaryPanel.tsx",
  "src/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview.tsx",
  "src/components/shopling-price-adjustment/ShoplingPriceAdjustmentOptionCanaryPanel.tsx",
  "src/components/shopling-price-adjustment/ShoplingPriceAdjustmentUnifiedCanaryPanel.tsx",
];

test("every price-adjustment API route requires an allowed operator", async () => {
  for (const path of operatorRoutes) {
    const source = await read(path);
    assert.match(source, /requireShoplingPriceAdjustmentOperator\(request\)/, path);
    assert.match(source, /if \(!auth\.ok\) return auth\.response/, path);
  }
  for (const path of adminRoutes) {
    const source = await read(path);
    assert.match(source, /requireShoplingPriceAdjustmentAdmin\(request\)/, path);
    assert.match(source, /if \(!auth\.ok\) return auth\.response/, path);
  }
});

test("operator auth verifies a server-rendered bearer and falls back to the canonical cookie", async () => {
  const source = await read("src/lib/shoplingPriceAdjustmentAuth.ts");
  const bypass = await read("src/lib/opsLoginBypass.ts");
  const identity = await read(
    "src/lib/shoplingPriceAdjustmentIdentity.ts",
  );

  assert.match(source, /isOpsLoginTemporarilyDisabled/);
  assert.match(source, /isSameOriginOpsRequest/);
  assert.match(source, /temporaryOpsIdentity/);
  assert.match(source, /OPS_LOGIN_BYPASS_SAME_ORIGIN_REQUIRED/);
  assert.match(bypass, /OPS_LOGIN_DISABLED/);
  assert.match(source, /await createSupabaseServerClient\(\)/);
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /supabase\.auth\.getUser\(bearer\.token\)/);
  assert.doesNotMatch(source, /supabase\.auth\.getClaims\(bearer\.token\)/);
  assert.match(source, /resolveShoplingPriceAdjustmentIdentity/);
  assert.match(source, /shoplingPriceAdjustmentOperatorEmails/);
  assert.match(source, /SHOPLING_PRICE_ADJUSTMENT_ALLOWED_EMAILS/);
  assert.match(source, /OPS_OWNER_EMAILS/);
  assert.match(source, /PRICE_ADJUSTMENT_OPERATOR_REQUIRED/);
  assert.match(source, /diagnostic_id/);
  assert.match(source, /request_auth_cookies_/);
  assert.match(source, /shoplingPriceAdjustmentPrivateHeaders/);
  assert.match(identity, /verifyBearer/);
  assert.match(identity, /verifyCookie/);
  assert.doesNotMatch(
    source,
    /service_role|SUPABASE_SECRET_KEY|localStorage|sessionStorage/,
  );
});

test("price-adjustment auth and job-list responses explicitly disable caching", async () => {
  const { shoplingPriceAdjustmentPrivateHeaders } =
    await importTranspiledTypeScript(
      new URL(
        "../src/lib/shoplingPriceAdjustmentResponse.ts",
        import.meta.url,
      ),
    );
  const jobsRoute = await read(
    "src/app/api/shopling-price-adjustment/bulk/jobs/route.ts",
  );
  const headers = shoplingPriceAdjustmentPrivateHeaders({
    "x-test-header": "kept",
  });

  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.equal(headers.get("x-test-header"), "kept");
  assert.match(jobsRoute, /dynamic = "force-dynamic"/);
  assert.match(jobsRoute, /revalidate = 0/);
  assert.match(jobsRoute, /shoplingPriceAdjustmentPrivateHeaders/);
});

test("price-adjustment requests carry only the server-verified in-memory token and same-origin cookies", async () => {
  const source = await read("src/lib/shoplingPriceAdjustmentApiClient.ts");
  const auth = await read("src/lib/shoplingPriceAdjustmentAuth.ts");
  const currentUser = await read("src/lib/supabase/currentUser.ts");
  const provider = await read(
    "src/components/shopling-price-adjustment/ShoplingPriceAdjustmentAuthProvider.tsx",
  );
  const page = await read(
    "src/app/shopling-price-adjustment-runner/page.tsx",
  );

  assert.match(source, /target\.origin !== origin/);
  assert.match(source, /target\.pathname\.startsWith\(SHOPLING_PRICE_ADJUSTMENT_API_PREFIX\)/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /redirect: "error"/);
  assert.match(source, /headers\.set\("authorization", `Bearer \$\{verifiedAccessToken\}`\)/);
  assert.match(source, /headers\.delete\("authorization"\)/);
  assert.match(source, /response\.status === 401/);
  assert.match(source, /SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT/);
  assert.doesNotMatch(source, /createSupabaseBrowserClient|getSession\(\)/);
  assert.match(auth, /verifyBearerIdentity\(request\)/);
  assert.match(auth, /verifyCookieIdentity/);
  assert.match(currentUser, /await createSupabaseServerClient\(\)/);
  assert.match(currentUser, /supabase\.auth\.getSession\(\)/);
  assert.match(currentUser, /supabase\.auth\.getUser\(accessToken\)/);
  assert.match(provider, /createContext<string \| null>/);
  assert.match(provider, /requestShoplingPriceAdjustmentApi\(input, init, accessToken\)/);
  assert.match(page, /ShoplingPriceAdjustmentAuthProvider accessToken=\{accessToken\}/);
  assert.match(page, /revalidate = 0/);
  assert.doesNotMatch(
    source + provider,
    /localStorage|sessionStorage/,
  );
});

test("a stale Authorization header cannot override the canonical cookie session", async () => {
  const {
    requestShoplingPriceAdjustmentApi,
  } = await import(
    "../src/lib/shoplingPriceAdjustmentApiClient.ts"
  );
  const hadWindow = Object.hasOwn(globalThis, "window");
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let captured = null;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin: "https://ops.example" },
      dispatchEvent() {},
    },
  });
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await requestShoplingPriceAdjustmentApi(
      "/api/shopling-price-adjustment/bulk/jobs",
      {
        headers: {
          Authorization: "Bearer stale-browser-token",
        },
      },
    );
    assert.equal(response.status, 200);
    assert.equal(
      captured.input,
      "https://ops.example/api/shopling-price-adjustment/bulk/jobs",
    );
    assert.equal(captured.init.credentials, "same-origin");
    assert.equal(
      new Headers(captured.init.headers).has("authorization"),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (hadWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      delete globalThis.window;
    }
  }
});

test("a freshly server-verified token replaces a stale Authorization header", async () => {
  const {
    requestShoplingPriceAdjustmentApi,
  } = await import(
    "../src/lib/shoplingPriceAdjustmentApiClient.ts"
  );
  const hadWindow = Object.hasOwn(globalThis, "window");
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let captured = null;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin: "https://ops.example" },
      dispatchEvent() {},
    },
  });
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return new Response("{}", { status: 200 });
  };

  try {
    await requestShoplingPriceAdjustmentApi(
      "/api/shopling-price-adjustment/bulk/jobs",
      {
        headers: {
          Authorization: "Bearer stale-browser-token",
        },
      },
      "fresh.server.verified.token",
    );
    assert.equal(
      new Headers(captured.init.headers).get("authorization"),
      "Bearer fresh.server.verified.token",
    );
    assert.equal(captured.init.credentials, "same-origin");
  } finally {
    globalThis.fetch = originalFetch;
    if (hadWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    } else {
      delete globalThis.window;
    }
  }
});

test("all price-adjustment UI requests use the guarded API client", async () => {
  for (const path of clientComponents) {
    const source = await read(path);
    assert.match(source, /requestShoplingPriceAdjustmentApi/, path);
    assert.match(source, /useShoplingPriceAdjustmentApi/, path);
    assert.doesNotMatch(source, /\bfetch\s*\(/, path);
  }
});

test("a stale page session can force one password reauthentication without losing bulk input", async () => {
  const batch = await read(clientComponents[0]);
  const login = await read("src/app/login/page.tsx");
  const storage = await read(
    "src/lib/shoplingPriceAdjustmentBulkSelection.ts",
  );

  assert.match(batch, /force=1/);
  assert.match(batch, /SHOPLING_PRICE_ADJUSTMENT_AUTH_REQUIRED_EVENT/);
  assert.match(batch, /로그인 다시 하기/);
  assert.match(login, /params\.force !== "1"/);
  assert.match(login, /clearOpsAuthCookiesBeforeSignIn\(\)/);
  assert.match(storage, /shoplingPriceAdjustment\.currentBulkSelection/);
});
