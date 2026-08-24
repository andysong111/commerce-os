import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const worker = await readFile(
  new URL("../scripts/reliability-autofix-worker.mjs", import.meta.url),
  "utf8",
);

function functionBlock(name, nextName) {
  const start = worker.indexOf(`function ${name}`);
  const end = worker.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return worker.slice(start, end);
}

test("autofix blocks new capabilities per file and caps reuse across the whole proposal", () => {
  const guard = functionBlock("assertProposalCapabilityBudget", "applyProposal");
  assert.match(guard, /beforeCount === 0 && afterCount > 0/);
  assert.match(guard, /Math\.max\(0, afterCount - beforeCount\)/);
  assert.match(guard, /if \(expansion > 2\)/);
  assert.match(guard, /across the proposal/);
  assert.match(guard, /Autofix cannot introduce new capability/);
});

test("multiple edits cannot reset the sensitive-capability allowance", () => {
  const planner = functionBlock("planProposalFiles", "assertProposalCapabilityBudget");
  const guard = functionBlock("assertProposalCapabilityBudget", "applyProposal");
  assert.match(planner, /planned = new Map/);
  assert.match(planner, /state\.current = state\.current\.replace/);
  assert.match(guard, /positiveExpansion = new Map/);
  assert.doesNotMatch(guard, /for\s*\(const edit of edits\)/);
});
