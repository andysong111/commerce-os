import assert from "node:assert/strict";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  DEFAULT_TEMPORARY_OPS_OWNER_ID,
  isOpsLoginTemporarilyDisabled,
  isSameOriginOpsRequest,
  temporaryOpsIdentity,
} = await importTranspiledTypeScript(
  new URL("../src/lib/opsLoginBypass.ts", import.meta.url),
);

test("Ops login bypass is on temporarily and can be restored by environment", () => {
  assert.equal(isOpsLoginTemporarilyDisabled({}), true);
  assert.equal(
    isOpsLoginTemporarilyDisabled({ OPS_LOGIN_DISABLED: "1" }),
    true,
  );
  assert.equal(
    isOpsLoginTemporarilyDisabled({ OPS_LOGIN_DISABLED: "0" }),
    false,
  );
});

test("temporary operator keeps the production owner scope", () => {
  assert.deepEqual(temporaryOpsIdentity({}), {
    userId: DEFAULT_TEMPORARY_OPS_OWNER_ID,
    email: "andy0801a@gmail.com",
  });
  assert.equal(
    temporaryOpsIdentity({
      OPS_LOGIN_BYPASS_USER_ID: "not-a-uuid",
      OPS_LOGIN_BYPASS_EMAIL: "OPS@EXAMPLE.COM",
    }).userId,
    DEFAULT_TEMPORARY_OPS_OWNER_ID,
  );
  assert.equal(
    temporaryOpsIdentity({
      OPS_LOGIN_BYPASS_EMAIL: "OPS@EXAMPLE.COM",
    }).email,
    "ops@example.com",
  );
});

test("temporary bypass accepts only requests from the same Ops Center", () => {
  const endpoint = "https://ops.example/api/shopling-price-adjustment/bulk/jobs";
  assert.equal(
    isSameOriginOpsRequest(
      new Request(endpoint, {
        headers: {
          origin: "https://ops.example",
          "sec-fetch-site": "same-origin",
        },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginOpsRequest(
      new Request(endpoint, {
        headers: {
          referer: "https://ops.example/shopling-price-adjustment-runner",
          "sec-fetch-site": "same-origin",
        },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginOpsRequest(
      new Request(endpoint, {
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    ),
    false,
  );
  assert.equal(isSameOriginOpsRequest(new Request(endpoint)), false);
});
