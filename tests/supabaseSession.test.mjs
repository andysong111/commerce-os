import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  OPS_AUTH_SESSION_DAYS,
  OPS_AUTH_COOKIE_MAX_AGE_SECONDS,
  getOpsAuthCookieOptions,
  getSafeOpsAuthRedirect,
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

test("로그인 후 복귀 경로는 같은 OPS Center 내부 경로만 허용한다", () => {
  assert.equal(
    getSafeOpsAuthRedirect("/detail-page-costs"),
    "/detail-page-costs",
  );
  assert.equal(
    getSafeOpsAuthRedirect("/account/password?from=menu"),
    "/account/password?from=menu",
  );
  assert.equal(
    getSafeOpsAuthRedirect("https://example.com"),
    "/sourcing-engine/settings",
  );
  assert.equal(
    getSafeOpsAuthRedirect("//example.com"),
    "/sourcing-engine/settings",
  );
  assert.equal(getSafeOpsAuthRedirect("/login"), "/sourcing-engine/settings");
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

test("브라우저 Supabase 설정은 Next.js가 정적으로 주입할 공개 환경변수를 직접 참조한다", async () => {
  const config = await readFile(
    new URL("../src/lib/supabase/config.ts", import.meta.url),
    "utf8",
  );
  const browser = await readFile(
    new URL("../src/lib/supabase/browser.ts", import.meta.url),
    "utf8",
  );

  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ]) {
    assert.match(
      config,
      new RegExp(`process\\.env\\.${name}`),
      `${name} must be a statically analyzable client reference`,
    );
  }
  assert.match(config, /export function getSupabaseBrowserPublicConfig/);
  assert.match(browser, /getSupabaseBrowserPublicConfig\(\)/);
  assert.doesNotMatch(browser, /getSupabasePublicConfig\(\)/);
});

test("한 RSC 요청 안의 인증 조회는 React cache로 한 번만 실행한다", async () => {
  const currentUser = await readFile(
    new URL("../src/lib/supabase/currentUser.ts", import.meta.url),
    "utf8",
  );
  const appShell = await readFile(
    new URL("../src/components/AppShell.tsx", import.meta.url),
    "utf8",
  );
  const detailCosts = await readFile(
    new URL("../src/app/detail-page-costs/page.tsx", import.meta.url),
    "utf8",
  );
  const login = await readFile(
    new URL("../src/app/login/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(currentUser, /cache\(loadOpsCurrentUser\)/);
  assert.match(currentUser, /supabase\.auth\.getUser\(\)/);
  assert.match(appShell, /getOpsCurrentUser\(\)/);
  assert.match(detailCosts, /getOpsCurrentUser\(\)/);
  assert.doesNotMatch(appShell + detailCosts, /auth\.getUser\(\)/);
  assert.match(detailCosts, /next=%2Fdetail-page-costs/);
  assert.match(login, /if \(user && params\.force !== "1"\) redirect\(nextPath\)/);
  assert.match(login, /name="next" value=\{nextPath\}/);
});
