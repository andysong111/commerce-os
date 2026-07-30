import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const COOKIE_NAME = "commerce-os-ops-auth-v2";
const TEST_EMAIL = "operator@example.com";
const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
const TEST_PUBLIC_KEY = "test-publishable-key";

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  return [
    encodeJwtPart({ alg: "HS256", typ: "JWT" }),
    encodeJwtPart({
      aud: "authenticated",
      email: TEST_EMAIL,
      exp: now + 3600,
      iat: now,
      role: "authenticated",
      sub: TEST_USER_ID,
    }),
    Buffer.from("test-signature").toString("base64url"),
  ].join(".");
}

function createCookieAdapter(initial = []) {
  const values = new Map(initial.map(({ name, value }) => [name, value]));
  return {
    getAll() {
      return [...values].map(([name, value]) => ({ name, value }));
    },
    async setAll(cookies) {
      for (const { name, value, options } of cookies) {
        if (options?.maxAge === 0 || value === "") {
          values.delete(name);
        } else {
          values.set(name, value);
        }
      }
    },
  };
}

async function withFakeSupabaseAuth(run) {
  const accessToken = makeAccessToken();
  const requests = [];
  const server = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
      body: Buffer.concat(body).toString("utf8"),
    });

    response.setHeader("content-type", "application/json");
    if (
      request.method === "POST" &&
      request.url === "/auth/v1/token?grant_type=password"
    ) {
      response.end(JSON.stringify({
        access_token: accessToken,
        expires_in: 3600,
        refresh_token: "test-refresh-token",
        token_type: "bearer",
        user: {
          id: TEST_USER_ID,
          email: TEST_EMAIL,
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date(0).toISOString(),
        },
      }));
      return;
    }
    if (
      request.method === "GET" &&
      request.url === "/auth/v1/user" &&
      request.headers.authorization === `Bearer ${accessToken}`
    ) {
      response.end(JSON.stringify({
        id: TEST_USER_ID,
        email: TEST_EMAIL,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date(0).toISOString(),
      }));
      return;
    }
    response.statusCode = 401;
    response.end(JSON.stringify({ message: "unexpected auth request" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run({
      accessToken,
      requests,
      url: `http://127.0.0.1:${address.port}`,
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("Supabase SSR 0.12 keeps a password session in the v2 cookie namespace and restores it", async () => {
  await withFakeSupabaseAuth(async ({ accessToken, requests, url }) => {
    const cookies = createCookieAdapter([
      { name: "sb-old-project-auth-token.0", value: "stale-part-zero" },
      { name: "sb-old-project-auth-token.1", value: "stale-part-one" },
    ]);
    const options = {
      cookieOptions: {
        name: COOKIE_NAME,
        maxAge: 15_552_000,
        path: "/",
        sameSite: "lax",
        secure: true,
      },
      cookies,
    };

    const loginClient = createServerClient(url, TEST_PUBLIC_KEY, options);
    const login = await loginClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: "test-password",
    });
    assert.equal(login.error, null);

    const namesAfterLogin = cookies.getAll().map(({ name }) => name);
    assert.ok(
      namesAfterLogin.some((name) =>
        name === COOKIE_NAME || name.startsWith(`${COOKIE_NAME}.`)
      ),
    );
    assert.ok(namesAfterLogin.includes("sb-old-project-auth-token.0"));

    const requestClient = createServerClient(url, TEST_PUBLIC_KEY, options);
    const session = await requestClient.auth.getSession();
    assert.equal(session.error, null);
    assert.equal(session.data.session?.access_token, accessToken);

    const user = await requestClient.auth.getUser(accessToken);
    assert.equal(user.error, null);
    assert.equal(user.data.user?.id, TEST_USER_ID);
    assert.equal(user.data.user?.email, TEST_EMAIL);
    assert.ok(
      requests.some((request) =>
        request.url === "/auth/v1/user" &&
        request.authorization === `Bearer ${accessToken}`
      ),
    );
  });
});

test("the bearer verifier rechecks the same server-issued token with Auth", async () => {
  await withFakeSupabaseAuth(async ({ accessToken, requests, url }) => {
    const client = createClient(url, TEST_PUBLIC_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const result = await client.auth.getUser(accessToken);
    assert.equal(result.error, null);
    assert.equal(result.data.user?.id, TEST_USER_ID);
    assert.equal(result.data.user?.email, TEST_EMAIL);
    assert.ok(
      requests.some((request) =>
        request.url === "/auth/v1/user" &&
        request.authorization === `Bearer ${accessToken}`
      ),
    );
  });
});
