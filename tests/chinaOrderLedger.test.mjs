import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadLedgerModule() {
  const sourcePath = new URL("../src/lib/chinaOrderLedger.ts", import.meta.url);
  const source = (await readFile(sourcePath, "utf8")).replace(
    /^import \{ createSupabaseAdminClient \} from "@\/lib\/supabase\/admin";\s*/,
    "",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const directory = await mkdtemp(join(dirname(sourcePath.pathname), ".ledger-test-"));
  const file = join(directory, "chinaOrderLedger.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const ledger = await loadLedgerModule();
const {
  normalizeChinaOrderCommitmentEvent,
  reduceChinaOrderCommitmentEvents,
  buildChinaOrderLedgerSummary,
} = ledger;

function event(overrides = {}) {
  return normalizeChinaOrderCommitmentEvent({
    sourceSystem: "china-order-manager",
    sourceLineId: "batch-1:line-1",
    sourceRunId: "batch-1",
    sourceEventId: "event-1",
    barcode: "BAA1-1",
    status: "RESERVED",
    requestedQuantity: 100,
    occurredAt: "2026-08-05T01:00:00.000Z",
    ...overrides,
  });
}

test("order, partial receipt and damage release produce one open commitment", () => {
  const snapshot = reduceChinaOrderCommitmentEvents([
    event(),
    event({
      sourceEventId: "event-2",
      status: "ORDERED",
      orderedQuantity: 90,
      occurredAt: "2026-08-05T02:00:00.000Z",
    }),
    event({
      sourceEventId: "event-3",
      status: "PARTIALLY_RECEIVED",
      receivedQuantity: 40,
      cancelledQuantity: 5,
      occurredAt: "2026-08-05T03:00:00.000Z",
    }),
  ]);

  assert.equal(snapshot.status, "PARTIALLY_RECEIVED");
  assert.equal(snapshot.requestedQuantity, 100);
  assert.equal(snapshot.orderedQuantity, 90);
  assert.equal(snapshot.receivedQuantity, 40);
  assert.equal(snapshot.cancelledQuantity, 5);
  assert.equal(snapshot.committedQuantity, 100);
  assert.equal(snapshot.openQuantity, 55);
});

test("final receipt closes the open commitment without double-counting", () => {
  const snapshot = reduceChinaOrderCommitmentEvents([
    event(),
    event({
      sourceEventId: "event-2",
      status: "ORDERED",
      orderedQuantity: 100,
      occurredAt: "2026-08-05T02:00:00.000Z",
    }),
    event({
      sourceEventId: "event-3",
      status: "PARTIALLY_RECEIVED",
      receivedQuantity: 40,
      occurredAt: "2026-08-05T03:00:00.000Z",
    }),
    event({
      sourceEventId: "event-4",
      status: "RECEIVED",
      receivedQuantity: 95,
      cancelledQuantity: 5,
      occurredAt: "2026-08-05T04:00:00.000Z",
    }),
  ]);

  assert.equal(snapshot.status, "RECEIVED");
  assert.equal(snapshot.receivedQuantity, 95);
  assert.equal(snapshot.cancelledQuantity, 5);
  assert.equal(snapshot.openQuantity, 0);
});

test("ledger summary ignores duplicate event identities", () => {
  const stored = {
    source_event_id: "stored-event-1",
    started_at: "2026-08-05T01:00:00.000Z",
    input_snapshot: event(),
  };
  const summary = buildChinaOrderLedgerSummary([stored, stored]);
  assert.equal(summary.totalCommitments, 1);
  assert.equal(summary.duplicateEventCount, 1);
  assert.equal(summary.totalOpenQuantity, 100);
});

test("managed barcode and source-line identity are fail-closed", () => {
  assert.throws(
    () => event({ barcode: "1234567890" }),
    /CHINA_ORDER_BARCODE_INVALID/,
  );
  assert.throws(
    () =>
      reduceChinaOrderCommitmentEvents([
        event(),
        event({
          sourceLineId: "different-line",
          sourceEventId: "event-2",
          occurredAt: "2026-08-05T02:00:00.000Z",
        }),
      ]),
    /CHINA_ORDER_EVENT_IDENTITY_CONFLICT/,
  );
});

test("event API is idempotent, same-origin guarded and never executes external writes", async () => {
  const route = await readFile(
    "src/app/api/china-order-ledger/events/route.ts",
    "utf8",
  );
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /x-commerce-os-integration-secret/);
  assert.match(route, /CHINA_ORDER_COMMITMENT_EVENT/);
  assert.match(route, /on_conflict=source_event_id/);
  assert.match(route, /resolution=ignore-duplicates/);
  assert.doesNotMatch(route, /shopling/i);
  assert.doesNotMatch(route, /1688/);
  assert.doesNotMatch(route, /inventory.*update|price.*update/i);
});
