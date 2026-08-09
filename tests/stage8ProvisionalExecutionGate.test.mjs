import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/lib/stage8InventoryVerificationPriority.ts", import.meta.url),
  "utf8",
);
const pageSource = fs.readFileSync(
  new URL("../src/app/stage8-inventory-verification-priority/page.tsx", import.meta.url),
  "utf8",
);

test("PROVISIONAL inventory remains usable for advisory math but not execution", () => {
  assert.match(
    source,
    /inventoryCalculationUsable =\s*mode === "VERIFIED" \|\| mode === "PROVISIONAL"/,
  );
  assert.match(source, /executionInventoryEligible = mode === "VERIFIED"/);
  assert.match(source, /advisoryOnly = mode === "PROVISIONAL"/);
  assert.match(source, /PROVISIONAL_DECISION_EVIDENCE_REQUIRED/);
});

test("operational readiness cannot open on provisional point inventory", () => {
  assert.match(
    source,
    /operationallyReady =\s*purchaseStatus === "발주 추천" &&\s*action === "NONE" &&\s*executionInventoryEligible/,
  );
  assert.match(
    source,
    /if \(mode === "PROVISIONAL"\) \{\s*return "PROVISIONAL_DECISION_EVIDENCE_REQUIRED"/,
  );
});

test("no full stocktake is reintroduced as an execution requirement", () => {
  assert.match(source, /stocktakeRequiredCount: 0/);
  assert.doesNotMatch(source, /STOCKTAKE_REQUIRED/);
  assert.match(pageSource, /재고실사 필수/);
  assert.match(pageSource, /PROVISIONAL ≠ VERIFIED/);
  assert.match(pageSource, /STOCKTAKE는 오류 교정용 선택 기능/);
});

test("page labels provisional recommendation as advisory only", () => {
  assert.match(pageSource, /PROVISIONAL advisory 발주후보/);
  assert.match(pageSource, /ADVISORY ONLY/);
  assert.match(pageSource, /추정재고 실행증거 필요/);
  assert.match(pageSource, /실제 발주 Draft를 실행하지 않습니다/);
});

test("execution gate itself performs no business writes", () => {
  assert.match(source, /writesEnabled: false/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.insert\(/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.update\(/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.upsert\(/);
  assert.doesNotMatch(source, /fetch\([^)]*method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
});
