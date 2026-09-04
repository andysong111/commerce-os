import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function edit(relativePath, transform) {
  const target = path.join(root, relativePath);
  const before = await readFile(target, "utf8");
  const after = transform(before);
  if (typeof after !== "string" || !after.length) {
    throw new Error(`INVALID_FINALIZER_OUTPUT:${relativePath}`);
  }
  if (after !== before) await writeFile(target, after, "utf8");
}

function replaceOnce(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  return source.replace(search, replacement);
}

await edit("src/lib/purchaseRecommendationFinalization.ts", (source) => {
  let next = source;
  const anchor = `  const stored = Array.isArray(result.data) ? result.data[0] : null;\n  return {\n    duplicate: !stored,\n    snapshot: {\n      ...snapshot,\n      id: text(stored?.id),\n    },\n  };`;
  const replacement = `  const stored = Array.isArray(result.data) ? result.data[0] : null;\n  if (!stored) {\n    const existing = await loadFinalizedPurchaseRecommendationV2(\n      report.cycleMonth,\n    );\n    if (existing?.sourceEventId === sourceEventId) {\n      return { duplicate: true, snapshot: existing };\n    }\n  }\n  return {\n    duplicate: !stored,\n    snapshot: {\n      ...snapshot,\n      id: text(stored?.id),\n    },\n  };`;
  next = replaceOnce(next, anchor, replacement, "finalization-duplicate-readback");
  return next;
});

await edit("src/app/api/china-order-ledger/events/route.ts", (source) => {
  let next = source;
  next = replaceOnce(
    next,
    'import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";',
    'import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";\nimport {\n  createPendingShoplingInventorySync,\n  loadInventoryLifecycleSnapshot,\n} from "@/lib/inventoryLifecycleLedger";',
    "receipt-restore-import",
  );
  const beforeReturn = `    const storedRows = Array.isArray(responseBody) ? responseBody : [];\n    return Response.json(`;
  const restoreLogic = `    const storedRows = Array.isArray(responseBody) ? responseBody : [];\n    let automaticSellingJob = null;\n    if (\n      storedRows.length > 0 &&\n      (event.status === "RECEIVED" ||\n        event.status === "PARTIALLY_RECEIVED") &&\n      (event.receivedQuantity ?? 0) > 0\n    ) {\n      try {\n        const lifecycle = await loadInventoryLifecycleSnapshot();\n        const row = lifecycle.rows.find(\n          (candidate) => candidate.barcode === event.barcode,\n        );\n        const positivePostResetStock = Boolean(\n          row &&\n            (row.exactInventoryQuantity ??\n              row.inboundAfterReset - row.salesAfterReset) > 0,\n        );\n        if (\n          row &&\n          positivePostResetStock &&\n          row.latestSuccessfulShoplingStatus === "SOLD_OUT" &&\n          !row.pendingJobId\n        ) {\n          automaticSellingJob = await createPendingShoplingInventorySync({\n            barcode: row.barcode,\n            modelNo: row.modelNo,\n            productName: row.productName,\n            productMode: row.productMode,\n            desiredStatus: "SELLING",\n            message:\n              row.productMode === "OPTION"\n                ? "입고확정으로 양수 재고 감지 · A6 판매중 전환 후 A22 상품옵션전송 대기"\n                : "입고확정으로 양수 재고 감지 · A6 판매중 전환 후 A21 상품판매상태 판매중 수정전송 대기",\n          });\n        }\n      } catch (restoreError) {\n        console.error("SHOPLING_SELLING_RESTORE_QUEUE_FAILED", {\n          barcode: event.barcode,\n          message:\n            restoreError instanceof Error\n              ? restoreError.message\n              : String(restoreError),\n        });\n      }\n    }\n    return Response.json(`;
  next = replaceOnce(
    next,
    beforeReturn,
    restoreLogic,
    "receipt-auto-selling-queue",
  );
  next = replaceOnce(
    next,
    "        event,\n        message:",
    "        event,\n        automaticSellingJob: automaticSellingJob?.event ?? null,\n        message:",
    "receipt-auto-selling-response",
  );
  return next;
});

await edit("src/components/china-order-manager/PurchaseV2Workspace.tsx", (source) => {
  let next = source;
  next = replaceOnce(
    next,
    "    if (!extensionReady || loading) return;\n    const candidate = lifecycle.rows.find(",
    "    if (\n      !extensionReady ||\n      loading ||\n      automaticRestoreStarted.current.size > 0\n    ) return;\n    const candidate = lifecycle.rows.find(",
    "auto-restore-one-at-time",
  );
  return next;
});

for (const workflow of [
  ".github/workflows/purchase-v2-stockout-lifecycle-ci.yml",
  ".github/workflows/purchase-v2-complete-ci.yml",
]) {
  await edit(workflow, (source) => {
    let next = source;
    next = next.replace(
      /- name: Apply deterministic finalizers[\s\S]*?node scripts\/finalize-purchase-v2-branch-2\.mjs/,
      "- name: Apply deterministic finalizers\n        run: |\n          node scripts/finalize-purchase-v2-branch-3.mjs\n          node scripts/finalize-purchase-v2-branch-4.mjs",
    );
    next = next.replace(
      /- name: Apply deterministic finalizer\n\s*run: node scripts\/finalize-purchase-v2-branch-3\.mjs/,
      "- name: Apply deterministic finalizers\n        run: |\n          node scripts/finalize-purchase-v2-branch-3.mjs\n          node scripts/finalize-purchase-v2-branch-4.mjs",
    );
    next = next.replace(
      /- name: Apply idempotent V2 finalizer\n\s*run: node scripts\/finalize-purchase-v2-branch-3\.mjs/,
      "- name: Apply idempotent V2 finalizers\n        run: |\n          node scripts/finalize-purchase-v2-branch-3.mjs\n          node scripts/finalize-purchase-v2-branch-4.mjs",
    );
    next = next.replace(
      /npx tsx --test\n([\s\S]*?)tests\/inventoryLifecycleLedger\.test\.mjs/,
      (match) =>
        match.includes("tests/purchaseV2Feedback.test.mjs")
          ? match
          : match.replace(
              "tests/inventoryLifecycleLedger.test.mjs",
              "tests/purchaseV2Feedback.test.mjs\n          tests/inventoryLifecycleLedger.test.mjs",
            ),
    );
    next = next.replace(
      /\n\s*tests\/purchaseV2Feedback\.test\.mjs(?=\n\s*\n\s*- name: Lint)/,
      "",
    );
    if (!next.includes("finalize-purchase-v2-branch-4.mjs")) {
      throw new Error(`WORKFLOW_FINALIZER4_MISSING:${workflow}`);
    }
    return next;
  });
}

console.log("PURCHASE_V2_BRANCH_FINALIZER_4_OK");
