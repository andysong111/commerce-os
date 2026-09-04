import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFreightImageSourceChain,
  isAllowedFreightImageHost,
  normalizeFreightImageUpstreamUrl,
  readFreightImageProxyUpstreamUrl,
  toFreightImageProxyUrl,
} from "../src/lib/freightImageProxy.ts";

test("allows only explicit Alibaba/1688 image hosts", () => {
  assert.equal(isAllowedFreightImageHost("cbu01.alicdn.com"), true);
  assert.equal(isAllowedFreightImageHost("img.alicdn.com"), true);
  assert.equal(isAllowedFreightImageHost("foo.1688.com"), true);
  assert.equal(isAllowedFreightImageHost("alicdn.com.evil.example"), false);
  assert.equal(isAllowedFreightImageHost("localhost"), false);
});

test("normalizes allowed image URLs and upgrades http", () => {
  assert.equal(
    normalizeFreightImageUpstreamUrl(
      "http://cbu01.alicdn.com/img/ibank/example.jpg#preview",
    ),
    "https://cbu01.alicdn.com/img/ibank/example.jpg",
  );
  assert.equal(
    normalizeFreightImageUpstreamUrl(
      "https://alicdn.com.evil.example/example.jpg",
    ),
    null,
  );
  assert.equal(
    normalizeFreightImageUpstreamUrl(
      "https://user:pass@cbu01.alicdn.com/example.jpg",
    ),
    null,
  );
});

test("builds a same-origin proxy URL and preserves direct fallback", () => {
  const upstream = "https://cbu01.alicdn.com/img/ibank/example.jpg";
  const proxy = toFreightImageProxyUrl(upstream);
  assert.equal(
    proxy,
    `/api/freight-image-proxy?url=${encodeURIComponent(upstream)}`,
  );
  assert.equal(readFreightImageProxyUpstreamUrl(proxy), upstream);
  assert.deepEqual(buildFreightImageSourceChain(upstream), [proxy, upstream]);
  assert.deepEqual(buildFreightImageSourceChain(proxy), [proxy, upstream]);
});

test("leaves local and blob image sources untouched", () => {
  assert.equal(toFreightImageProxyUrl("blob:https://example.com/abc"), null);
  assert.deepEqual(buildFreightImageSourceChain("blob:https://example.com/abc"), [
    "blob:https://example.com/abc",
  ]);
  assert.deepEqual(buildFreightImageSourceChain("/local/product.jpg"), [
    "/local/product.jpg",
  ]);
});
