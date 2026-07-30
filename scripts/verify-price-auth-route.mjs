import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const nextCli = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const endpoint = `${origin}/api/shopling-price-adjustment/bulk/jobs`;
const runnerPage = `${origin}/shopling-price-adjustment-runner`;
const child = spawn(
  process.execPath,
  [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    logs = `${logs}${chunk}`.slice(-12_000);
  });
}

async function waitForResponse() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before route verification:\n${logs}`);
    }
    try {
      return await fetch(endpoint, {
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Next.js did not become ready:\n${logs}`);
}

try {
  const getResponse = await waitForResponse();
  const getBody = await getResponse.json();
  assert.equal(getResponse.status, 403);
  assert.equal(getBody.code, "OPS_LOGIN_BYPASS_SAME_ORIGIN_REQUIRED");
  assert.equal(getBody.stage, "price_adjustment.auth");
  assert.match(getBody.diagnostic_id, /^[0-9a-f-]{36}$/);
  assert.equal(
    getResponse.headers.get("cache-control"),
    "private, no-store",
  );

  const postResponse = await fetch(endpoint, {
    method: "POST",
    body: "{invalid-json",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
    },
    redirect: "error",
  });
  const postBody = await postResponse.json();
  assert.equal(postResponse.status, 403);
  assert.equal(postBody.code, "OPS_LOGIN_BYPASS_SAME_ORIGIN_REQUIRED");
  assert.equal(postBody.stage, "price_adjustment.auth");
  assert.equal(
    postResponse.headers.get("cache-control"),
    "private, no-store",
  );

  const pageResponse = await fetch(runnerPage, {
    cache: "no-store",
    redirect: "error",
  });
  const pageBody = await pageResponse.text();
  assert.equal(pageResponse.status, 200);
  assert.match(pageBody, /로그인은 임시 해제 상태입니다/);

  const sameOriginResponse = await fetch(endpoint, {
    cache: "no-store",
    headers: {
      origin,
      referer: runnerPage,
    },
    redirect: "error",
  });
  const sameOriginBody = await sameOriginResponse.json();
  assert.equal(sameOriginResponse.status, 503);
  assert.equal(
    sameOriginBody.code,
    "PRICE_ADJUSTMENT_ADMIN_CONFIGURATION_ERROR",
  );
  assert.notEqual(sameOriginBody.code, "PRICE_ADJUSTMENT_AUTH_REQUIRED");

  console.log(
    "The runner opens without login, same-origin UI requests pass the temporary bypass, and outside requests stay blocked.",
  );
} finally {
  await stop(child);
}
