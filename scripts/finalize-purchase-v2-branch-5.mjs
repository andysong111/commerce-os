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

await edit("src/app/api/china-order-ledger/events/route.ts", (source) => {
  let next = source;
  next = next.replace(
    `      (event.status === "RECEIVED" ||\n        event.status === "PARTIALLY_RECEIVED") &&\n      (event.receivedQuantity ?? 0) > 0`,
    `      (event.status === "RECEIVED" ||\n        (event.status === "PARTIALLY_RECEIVED" &&\n          (event.receivedQuantity ?? 0) > 0))`,
  );
  const old = `        const positivePostResetStock = Boolean(\n          row &&\n            (row.exactInventoryQuantity ??\n              row.inboundAfterReset - row.salesAfterReset) > 0,\n        );\n        if (\n          row &&\n          positivePostResetStock &&\n          row.latestSuccessfulShoplingStatus === "SOLD_OUT" &&`;
  const replacement = `        if (\n          row &&\n          row.latestSuccessfulShoplingStatus === "SOLD_OUT" &&`;
  if (next.includes(old)) next = next.replace(old, replacement);
  return next;
});

await edit("src/components/china-order-manager/PurchaseV2Workspace.tsx", (source) => {
  let next = source;
  const old = `    const candidate = lifecycle.rows.find(\n      (row) =>\n        row.nextRecommendedSync === "SELLING" &&\n        !row.pendingJobId &&\n        row.exactInventoryKnown &&\n        (row.exactInventoryQuantity ?? 0) > 0 &&\n        !automaticRestoreStarted.current.has(row.barcode),\n    );\n    if (!candidate) return;\n    automaticRestoreStarted.current.add(candidate.barcode);\n    void restore(candidate, false);`;
  const replacement = `    const pendingCandidate = lifecycle.rows.find(\n      (row) =>\n        row.pendingJobId &&\n        row.pendingDesiredStatus === "SELLING" &&\n        !automaticRestoreStarted.current.has(row.barcode),\n    );\n    if (pendingCandidate) {\n      automaticRestoreStarted.current.add(pendingCandidate.barcode);\n      resumePending(pendingCandidate);\n      return;\n    }\n    const candidate = lifecycle.rows.find(\n      (row) =>\n        row.nextRecommendedSync === "SELLING" &&\n        !row.pendingJobId &&\n        row.exactInventoryKnown &&\n        (row.exactInventoryQuantity ?? 0) > 0 &&\n        !automaticRestoreStarted.current.has(row.barcode),\n    );\n    if (!candidate) return;\n    automaticRestoreStarted.current.add(candidate.barcode);\n    void restore(candidate, false);`;
  next = replaceOnce(next, old, replacement, "workspace-auto-run-pending-selling");
  return next;
});

await edit("public/shopling-inventory-lifecycle/background.js", (source) => {
  let next = source.replaceAll('"0.1.1"', '"0.1.2"');
  const anchor = `      if (message?.type === "SHOPLING_LIFECYCLE_GET_JOB") {`;
  const handler = `      if (message?.type === "SHOPLING_LIFECYCLE_PREPARE_DIALOGS") {\n        const tabId = sender.tab?.id;\n        if (!Number.isInteger(tabId)) {\n          sendResponse({ ok: false, error: "SHOPLING_DIALOG_TAB_REQUIRED" });\n          return;\n        }\n        await chrome.scripting.executeScript({\n          target: {\n            tabId,\n            ...(Number.isInteger(sender.frameId) && sender.frameId > 0\n              ? { frameIds: [sender.frameId] }\n              : {}),\n          },\n          world: "MAIN",\n          func: () => {\n            const originalConfirm = window.confirm;\n            const originalAlert = window.alert;\n            window.confirm = () => true;\n            window.alert = () => undefined;\n            window.setTimeout(() => {\n              window.confirm = originalConfirm;\n              window.alert = originalAlert;\n            }, 8_000);\n          },\n        });\n        sendResponse({ ok: true });\n        return;\n      }\n`;
  next = replaceOnce(next, anchor, `${handler}${anchor}`, "extension-dialog-handler");
  return next;
});

await edit("public/shopling-inventory-lifecycle/content-shopling.js", (source) => {
  let next = source.replaceAll('"0.1.1"', '"0.1.2"');
  const clickAnchor = `  async function sendOk(job, step, message) {`;
  const prepare = `  async function preparePageDialogs() {\n    const response = await chrome.runtime\n      .sendMessage({ type: "SHOPLING_LIFECYCLE_PREPARE_DIALOGS" })\n      .catch(() => null);\n    return response?.ok === true;\n  }\n\n`;
  next = replaceOnce(next, clickAnchor, `${prepare}${clickAnchor}`, "extension-prepare-dialog-function");
  next = replaceOnce(
    next,
    "    markAssignment(job);\n    if (!clickElement(button)) {\n      return sendFail(\n        job,\n        \"A6_STATUS_CLICK_FAILED\"",
    "    markAssignment(job);\n    await preparePageDialogs();\n    if (!clickElement(button)) {\n      return sendFail(\n        job,\n        \"A6_STATUS_CLICK_FAILED\"",
    "extension-a6-dialog-prep",
  );
  next = replaceOnce(
    next,
    "    markAssignment({ ...job, stage: \"A22_RESULT\" });\n    if (!clickElement(button)) {",
    "    markAssignment({ ...job, stage: \"A22_RESULT\" });\n    await preparePageDialogs();\n    if (!clickElement(button)) {",
    "extension-a22-dialog-prep",
  );
  next = replaceOnce(
    next,
    "    const submit = exactClickable([\"상품수정 송신\", \"상품수정송신\"]);\n    if (!submit || !clickElement(submit)) {",
    "    const submit = exactClickable([\"상품수정 송신\", \"상품수정송신\"]);\n    await preparePageDialogs();\n    if (!submit || !clickElement(submit)) {",
    "extension-a21-dialog-prep",
  );
  next = next.replace(
    `    if (job.stage === "NAVIGATE_A6" && currentRole === "MENU") {`,
    `    if (\n      job.stage === "NAVIGATE_A6" &&\n      ["MENU", "OTHER", "A6", "A21_LIST", "A22"].includes(currentRole)\n    ) {`,
  );
  return next;
});

for (const file of [
  "public/shopling-inventory-lifecycle/content-ops.js",
]) {
  await edit(file, (source) => source.replaceAll('"0.1.1"', '"0.1.2"'));
}
await edit("public/shopling-inventory-lifecycle/manifest.json", (source) =>
  source.replace('"version": "0.1.1"', '"version": "0.1.2"'),
);
await edit("public/shopling-inventory-lifecycle/popup.html", (source) =>
  source.replace("COMMERCE OS · v0.1.1", "COMMERCE OS · v0.1.2"),
);
await edit("public/shopling-inventory-lifecycle/README.txt", (source) =>
  source.replace("v0.1.1", "v0.1.2"),
);
await edit(
  "src/app/api/shopling-inventory-lifecycle-extension/download/route.ts",
  (source) => source.replaceAll("v0.1.1", "v0.1.2"),
);

for (const workflow of [
  ".github/workflows/purchase-v2-stockout-lifecycle-ci.yml",
  ".github/workflows/purchase-v2-complete-ci.yml",
  ".github/workflows/purchase-v2-authoritative-ci.yml",
]) {
  await edit(workflow, (source) => {
    let next = source;
    const run4 = "          node scripts/finalize-purchase-v2-branch-4.mjs";
    if (next.includes(run4) && !next.includes("finalize-purchase-v2-branch-5.mjs")) {
      next = next.replace(
        run4,
        `${run4}\n          node scripts/finalize-purchase-v2-branch-5.mjs`,
      );
    }
    if (!next.includes("finalize-purchase-v2-branch-5.mjs")) {
      throw new Error(`WORKFLOW_FINALIZER5_MISSING:${workflow}`);
    }
    if (
      next.includes("tests/shoplingInventoryLifecycleExtension.test.mjs") &&
      !next.includes("tests/receiptSellingRestoreContract.test.mjs")
    ) {
      next = next.replace(
        "tests/shoplingInventoryLifecycleExtension.test.mjs",
        "tests/shoplingInventoryLifecycleExtension.test.mjs\n          tests/receiptSellingRestoreContract.test.mjs",
      );
    }
    return next;
  });
}

console.log("PURCHASE_V2_BRANCH_FINALIZER_5_OK");
