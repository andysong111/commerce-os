import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  requestShoplingPriceBulkJson,
  ShoplingPriceBulkApiError,
  SHOPLING_PRICE_BULK_AUDIT_MAX_EVENTS,
  SHOPLING_PRICE_BULK_AUDIT_MAX_PAGES,
} = await importTranspiledTypeScript(new URL("../src/lib/shoplingPriceModifyBulkClient.ts", import.meta.url));

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("audit collection follows before_id sequentially, deduplicates IDs, and retains the full result", async () => {
  const previousFetch = globalThis.fetch;
  const responses = [
    { events: [{ id: 300, event_type: "newest" }, { id: 299, event_type: "a" }], next_before_id: 299 },
    { events: [{ id: 299, event_type: "duplicate" }, { id: 298, event_type: "b" }], next_before_id: 298 },
    { events: [{ id: 297, event_type: "oldest" }], next_before_id: null },
  ];
  const urls = [];
  let active = 0;
  let maxActive = 0;

  globalThis.fetch = async (input) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    urls.push(String(input));
    await Promise.resolve();
    const next = responses.shift();
    active -= 1;
    if (!next) throw new Error("unexpected audit request");
    return jsonResponse(next);
  };

  try {
    const body = await requestShoplingPriceBulkJson(
      "/api/shopling-price-modify/bulk/jobs/job-1/audit",
      undefined,
      "bulk_ops.audit",
    );
    assert.deepEqual(body.events.map((event) => event.id), [300, 299, 298, 297]);
    assert.equal(body.audit_page_count, 3);
    assert.equal(body.audit_truncated, false);
    assert.equal(body.next_before_id, null);
    assert.equal(maxActive, 1);
    assert.equal(urls.length, 3);
    assert.match(urls[1], /before_id=299/);
    assert.match(urls[2], /before_id=298/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("audit collection rejects repeated or non-decreasing cursors", async () => {
  const previousFetch = globalThis.fetch;
  const responses = [
    { events: [{ id: 101 }], next_before_id: 100 },
    { events: [{ id: 99 }], next_before_id: 100 },
  ];
  globalThis.fetch = async () => jsonResponse(responses.shift());
  try {
    await assert.rejects(
      () => requestShoplingPriceBulkJson("/api/jobs/job-1/audit", undefined, "bulk_ops.audit"),
      (error) => error instanceof ShoplingPriceBulkApiError && /커서/.test(error.message),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("audit collection stops at the hard page bound instead of looping", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    const index = calls++;
    return jsonResponse({
      events: [{ id: 10_000 - index }],
      next_before_id: 9_999 - index,
    });
  };
  try {
    await assert.rejects(
      () => requestShoplingPriceBulkJson("/api/jobs/job-1/audit", undefined, "bulk_ops.audit"),
      (error) => error instanceof ShoplingPriceBulkApiError && /안전 페이지 한도/.test(error.message),
    );
    assert.equal(calls, SHOPLING_PRICE_BULK_AUDIT_MAX_PAGES);
    assert.equal(SHOPLING_PRICE_BULK_AUDIT_MAX_PAGES, 20);
    assert.equal(SHOPLING_PRICE_BULK_AUDIT_MAX_EVENTS, 20_000);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("non-audit API requests keep the existing single-request behavior", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ events: [{ id: 2 }], next_before_id: 1 });
  };
  try {
    const body = await requestShoplingPriceBulkJson("/api/other", undefined, "bulk_jobs.list");
    assert.equal(calls, 1);
    assert.equal(body.next_before_id, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("operations UI keeps all collected audit events for download but renders only 100", async () => {
  const ui = await read("src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkOperations.tsx");
  assert.match(ui, /requestShoplingPriceBulkJson\([^]*?bulk_ops\.audit/);
  assert.match(ui, /setAudit\(events\)/);
  assert.match(ui, /events: audit/);
  assert.match(ui, /audit\.slice\(0, 100\)/);
  assert.doesNotMatch(ui, /Promise\.all\([^]*?bulk_ops\.audit/);
  assert.doesNotMatch(ui, /setInterval/);
});

test("validation and archive controls reject null or non-object JSON before property access", async () => {
  const routes = await Promise.all([
    read("src/app/api/shopling-price-modify/bulk/validation-jobs/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/archive/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/restore/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/archive-stale/route.ts"),
  ]);
  for (const route of routes) {
    assert.match(route, /!body\s*\|\|\s*typeof body !== "object"\s*\|\|\s*Array\.isArray\(body\)/);
  }
});
