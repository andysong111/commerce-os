import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  VERIFIED_PRODUCT_DECISION_BACKUP,
  buildProductDecisionSnapshot,
  stableStringify,
  validateProductDecisionBackupMetadata,
} from "../src/lib/productDecisionSnapshot.ts";

const importRoute = await readFile(
  "src/app/api/product-decision-agent/migration/import/route.ts",
  "utf8",
);
const importer = await readFile(
  "src/app/product-decision-agent/migration/ProductDecisionSnapshotImporter.tsx",
  "utf8",
);
const integration = await readFile(
  "src/lib/integrations/productDecisionAgent.ts",
  "utf8",
);

function verifiedMetadata() {
  return {
    manifest: {
      ok: true,
      formatVersion: 1,
      exportedAt: VERIFIED_PRODUCT_DECISION_BACKUP.exportedAt,
      tables: Object.entries(VERIFIED_PRODUCT_DECISION_BACKUP.counts).map(
        ([name, count]) => ({ name, count }),
      ),
    },
    completed: {
      ok: true,
      formatVersion: 1,
      completedAt: VERIFIED_PRODUCT_DECISION_BACKUP.completedAt,
      source: VERIFIED_PRODUCT_DECISION_BACKUP.source,
      counts: { ...VERIFIED_PRODUCT_DECISION_BACKUP.counts },
    },
  };
}

test("verified D1 backup metadata rejects any different archive or row count", () => {
  const { manifest, completed } = verifiedMetadata();
  assert.doesNotThrow(() =>
    validateProductDecisionBackupMetadata(
      manifest,
      completed,
      VERIFIED_PRODUCT_DECISION_BACKUP.zipSha256,
    ),
  );
  assert.throws(
    () => validateProductDecisionBackupMetadata(manifest, completed, "0".repeat(64)),
    /검증된 발주 추천 D1 백업과 일치하지 않습니다/,
  );
  const changed = verifiedMetadata();
  changed.completed.counts.decision_items += 1;
  assert.throws(
    () =>
      validateProductDecisionBackupMetadata(
        changed.manifest,
        changed.completed,
        VERIFIED_PRODUCT_DECISION_BACKUP.zipSha256,
      ),
    /decision_items 행 수/,
  );
});

test("snapshot builder selects the latest run and creates exactly 316 read-only rows", () => {
  const decision_items = [];
  const canonical_products = [];
  const decision_evidence = [];
  for (let index = 0; index < VERIFIED_PRODUCT_DECISION_BACKUP.productCount; index += 1) {
    const barcode = `BTEST-${String(index).padStart(3, "0")}`;
    decision_items.push({
      run_id: "latest-run",
      barcode,
      total_score: index,
      trend_label: "유지",
      forecast_units: index + 1,
      recommended_quantity_gross: index < 2 ? 10 : 0,
      expected_cost: index < 2 ? 1_000 : 0,
      decision_status: index < 2 ? "발주 추천" : "발주 보류",
      flags_json: JSON.stringify(["수요목표:10", "재고기준:없음"]),
    });
    canonical_products.push({ barcode, canonical_name: `테스트 상품 ${index}` });
    decision_evidence.push({
      run_id: "latest-run",
      barcode,
      purchase_need_score: index,
      calculation_json: JSON.stringify({
        order: { forecastUnits: index + 1 },
        netRequirement: {
          demandTarget: 10,
          estimatedStock: 0,
          openCommitment: 0,
          securedQuantity: 0,
          netRequiredRaw: 10,
          inventoryKnown: false,
        },
      }),
    });
  }

  const snapshot = buildProductDecisionSnapshot({
    decision_runs: [
      {
        id: "old-run",
        generated_at: "2026-08-01T00:00:00.000Z",
        status: "DRAFT",
      },
      {
        id: "latest-run",
        generated_at: "2026-08-04T09:45:20.591Z",
        status: "DRAFT",
        budget: 3_000,
        budget_basis: "테스트 예산",
      },
    ],
    decision_items,
    canonical_products,
    decision_evidence,
    product_planning_profiles: [],
  });

  assert.equal(snapshot.runId, "latest-run");
  assert.equal(snapshot.generatedAt, "2026-08-04T09:45:20.591Z");
  assert.equal(snapshot.products.length, 316);
  assert.equal(snapshot.products[0].barcode, "BTEST-315");
  assert.equal(snapshot.expectedSpend, 2_000);
  assert.equal(snapshot.products[0].inventoryKnown, false);
});

test("stable JSON sorting is deterministic", () => {
  assert.equal(
    stableStringify({ z: 1, a: { y: 2, b: 3 } }),
    stableStringify({ a: { b: 3, y: 2 }, z: 1 }),
  );
});

test("migration writes only the verified snapshot to the existing operation ledger", () => {
  assert.match(importRoute, /VERIFIED_PRODUCT_DECISION_BACKUP\.dashboardSha256/);
  assert.match(importRoute, /commerce_operation_runs/);
  assert.match(importRoute, /PRODUCT_DECISION_SNAPSHOT_IMPORT/);
  assert.match(importRoute, /resolution=ignore-duplicates/);
  assert.doesNotMatch(importRoute, /resolution=merge-duplicates/);
  assert.doesNotMatch(importRoute, /shopling/i);
  assert.doesNotMatch(importRoute, /1688/);
  assert.doesNotMatch(importRoute, /DELETE/);
});

test("browser importer validates ZIP, table counts and dashboard hash before POST", () => {
  assert.match(importer, /sha256Hex\(buffer\)/);
  assert.match(importer, /validateProductDecisionBackupMetadata/);
  assert.match(importer, /buildProductDecisionSnapshot/);
  assert.match(importer, /VERIFIED_PRODUCT_DECISION_BACKUP\.dashboardSha256/);
  assert.match(importer, /\/api\/product-decision-agent\/migration\/import/);
});

test("product decision loader prefers the internal immutable snapshot", () => {
  assert.match(integration, /PRODUCT_DECISION_SNAPSHOT_IMPORT/);
  assert.match(integration, /commerce_operation_runs/);
  assert.match(integration, /sourceMode: "internal_snapshot"/);
  assert.match(integration, /loadInternalSnapshot/);
});
