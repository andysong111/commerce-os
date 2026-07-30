import assert from "node:assert/strict";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  resolveShoplingPriceAdjustmentIdentity,
} = await importTranspiledTypeScript(
  new URL(
    "../src/lib/shoplingPriceAdjustmentIdentity.ts",
    import.meta.url,
  ),
);

const allowed = (email) => email === "operator@example.com";
const verified = (email = "operator@example.com") => ({
  status: "verified",
  identity: {
    userId: "user-1",
    email,
  },
});
const invalid = (reason = "invalid") => ({
  status: "invalid",
  reason,
});
const missing = {
  status: "missing",
  reason: "missing",
};

test("fresh verified bearer authenticates without reading the cookie", async () => {
  let cookieChecks = 0;
  const result = await resolveShoplingPriceAdjustmentIdentity({
    verifyBearer: async () => verified(" Operator@Example.com "),
    verifyCookie: async () => {
      cookieChecks += 1;
      return missing;
    },
    isAllowedEmail: allowed,
  });

  assert.equal(result.ok, true);
  assert.equal(result.transport, "bearer");
  assert.equal(result.identity.email, "operator@example.com");
  assert.equal(cookieChecks, 0);
});

test("invalid stale bearer cannot override a valid cookie", async () => {
  const result = await resolveShoplingPriceAdjustmentIdentity({
    verifyBearer: async () => invalid("expired"),
    verifyCookie: async () => verified(),
    isAllowedEmail: allowed,
  });

  assert.equal(result.ok, true);
  assert.equal(result.transport, "cookie");
  assert.equal(result.bearerStatus, "invalid");
});

test("invalid bearer and missing cookie fail closed", async () => {
  const result = await resolveShoplingPriceAdjustmentIdentity({
    verifyBearer: async () => invalid("malformed"),
    verifyCookie: async () => missing,
    isAllowedEmail: allowed,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unauthenticated");
  assert.equal(result.bearerReason, "malformed");
  assert.equal(result.cookieReason, "missing");
});

test("verified non-operator bearer is forbidden without cookie fallback", async () => {
  let cookieChecks = 0;
  const result = await resolveShoplingPriceAdjustmentIdentity({
    verifyBearer: async () => verified("other@example.com"),
    verifyCookie: async () => {
      cookieChecks += 1;
      return verified();
    },
    isAllowedEmail: allowed,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden");
  assert.equal(cookieChecks, 0);
});

test("authentication infrastructure errors stay distinct from login absence", async () => {
  const result = await resolveShoplingPriceAdjustmentIdentity({
    verifyBearer: async () => ({
      status: "unavailable",
      reason: "jwks_unavailable",
    }),
    verifyCookie: async () => ({
      status: "unavailable",
      reason: "auth_service_unavailable",
    }),
    isAllowedEmail: allowed,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unavailable");
});
