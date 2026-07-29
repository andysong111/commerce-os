import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  OPS_AUTH_SESSION_DAYS,
  OPS_AUTH_COOKIE_MAX_AGE_SECONDS,
  getOpsAuthCookieOptions,
} = await importTranspiledTypeScript(
  new URL("../src/lib/supabase/session.ts", import.meta.url),
);

test("OPS 로그인 쿠키는 개인 기기에서 180일 유지된다", () => {
  assert.equal(OPS_AUTH_SESSION_DAYS, 180);
  assert.equal(OPS_AUTH_COOKIE_MAX_AGE_SECONDS, 15_552_000);
  assert.deepEqual(getOpsAuthCookieOptions("production"), {
    maxAge: 15_552_000,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
  assert.equal(getOpsAuthCookieOptions("development").secure, false);
});

test("Next.js Proxy가 요청과 응답 쿠키를 함께 갱신한다", async () => {
  const rootProxy = await readFile(
    new URL("../proxy.ts", import.meta.url),
    "utf8",
  );
  const sessionProxy = await readFile(
    new URL("../src/lib/supabase/proxy.ts", import.meta.url),
    "utf8",
  );

  assert.match(rootProxy, /export async function proxy/);
  assert.match(rootProxy, /updateSession\(request\)/);
  assert.match(sessionProxy, /request\.cookies\.set\(name, value\)/);
  assert.match(sessionProxy, /response\.cookies\.set\(name, value, options\)/);
  assert.match(sessionProxy, /supabase\.auth\.getClaims\(\)/);
  assert.match(sessionProxy, /private, no-store/);
});

test("서버와 브라우저 Supabase 클라이언트가 같은 장기 쿠키 정책을 쓴다", async () => {
  const server = await readFile(
    new URL("../src/lib/supabase/server.ts", import.meta.url),
    "utf8",
  );
  const browser = await readFile(
    new URL("../src/lib/supabase/browser.ts", import.meta.url),
    "utf8",
  );

  assert.match(server, /cookieOptions: getOpsAuthCookieOptions\(\)/);
  assert.match(browser, /cookieOptions: getOpsAuthCookieOptions\(\)/);
});
