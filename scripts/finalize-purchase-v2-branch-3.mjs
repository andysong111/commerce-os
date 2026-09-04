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

await edit("src/lib/productDecisionEngine/purchaseV2.ts", (source) => {
  let next = source;
  next = replaceOnce(
    next,
    "  stockoutRecoveredUnits: number;\n  monthlyDemandForecast: number;",
    "  stockoutRecoveredUnits: number;\n  feedbackMultiplier: number;\n  monthlyDemandForecast: number;",
    "purchase-v2-feedback-type",
  );
  next = replaceOnce(
    next,
    "    stockoutRecoveredUnits: availability.recoveredUnits,\n    monthlyDemandForecast,",
    "    stockoutRecoveredUnits: availability.recoveredUnits,\n    feedbackMultiplier,\n    monthlyDemandForecast,",
    "purchase-v2-feedback-return",
  );
  return next;
});

await edit("src/lib/purchaseRecommendationV2.ts", (source) => {
  let next = source;
  next = replaceOnce(
    next,
    'import { loadProductMasterCanonicalSalesAudit } from "@/lib/productMasterCanonicalSalesAudit";',
    'import { loadProductMasterCanonicalSalesAudit } from "@/lib/productMasterCanonicalSalesAudit";\nimport {\n  loadPreviousPurchaseV2FeedbackReference,\n  purchaseV2FeedbackMultiplier,\n} from "@/lib/purchaseV2Feedback";',
    "purchase-v2-feedback-import",
  );
  next = replaceOnce(
    next,
    "  stockoutRecoveredUnits: number;\n  priceChangeRate: number | null;",
    "  stockoutRecoveredUnits: number;\n  feedbackMultiplier: number;\n  priceChangeRate: number | null;",
    "purchase-v2-report-feedback-type",
  );
  next = replaceOnce(
    next,
    "    stockoutRecoveredUnits: item.demand.stockoutRecoveredUnits,\n    priceChangeRate: item.demand.priceChangeRate,",
    "    stockoutRecoveredUnits: item.demand.stockoutRecoveredUnits,\n    feedbackMultiplier: item.demand.feedbackMultiplier,\n    priceChangeRate: item.demand.priceChangeRate,",
    "purchase-v2-report-feedback-row",
  );
  next = replaceOnce(
    next,
    "  const [audit, planning, diagnostics, lifecycle, commitments, shadow, purchase] =\n    await Promise.all([",
    "  const [\n    audit,\n    planning,\n    diagnostics,\n    lifecycle,\n    commitments,\n    shadow,\n    purchase,\n    feedbackReference,\n  ] = await Promise.all([",
    "purchase-v2-feedback-promise-destructure",
  );
  next = replaceOnce(
    next,
    "      loadInternalChinaMonthlyPurchaseSummary(cycle.cycleMonth).catch(\n        () => null,\n      ),\n    ]);",
    "      loadInternalChinaMonthlyPurchaseSummary(cycle.cycleMonth).catch(\n        () => null,\n      ),\n      loadPreviousPurchaseV2FeedbackReference(cycle.cycleMonth),\n    ]);",
    "purchase-v2-feedback-promise-item",
  );
  next = replaceOnce(
    next,
    "  const modelNoByBarcode = new Map<string, string | null>();\n  const unitCostByBarcode = new Map<string, number>();",
    "  const modelNoByBarcode = new Map<string, string | null>();\n  const unitCostByBarcode = new Map<string, number>();\n  const feedbackByBarcode = new Map(\n    (feedbackReference?.rows ?? []).map((row) => [barcode(row.barcode), row] as const),\n  );",
    "purchase-v2-feedback-map",
  );
  next = replaceOnce(
    next,
    "      unitCostByBarcode.set(key, Math.round(unitCost));\n      return calculatePurchaseV2Product({",
    "      unitCostByBarcode.set(key, Math.round(unitCost));\n      const previousFeedback = feedbackByBarcode.get(key);\n      const feedbackMultiplier = previousFeedback\n        ? purchaseV2FeedbackMultiplier({\n            previousMonthlyForecast: previousFeedback.monthlyDemandForecast,\n            previousFeedbackMultiplier: previousFeedback.feedbackMultiplier,\n            actualRecent30Units: quantity(units[0]),\n            previousStockoutRecoveredUnits:\n              previousFeedback.stockoutRecoveredUnits,\n            previousPriceChangeRate: previousFeedback.priceChangeRate,\n          })\n        : 1;\n      return calculatePurchaseV2Product({",
    "purchase-v2-feedback-calc",
  );
  next = replaceOnce(
    next,
    "        availableDaysByBucket: lifecycleRow?.availableDaysByBucket,\n        feedbackMultiplier: 1,",
    "        availableDaysByBucket: lifecycleRow?.availableDaysByBucket,\n        feedbackMultiplier,",
    "purchase-v2-feedback-input",
  );
  next = replaceOnce(
    next,
    "    priceSignal: row.priceSignal,\n    priorityScore: row.priorityScore,",
    "    priceSignal: row.priceSignal,\n    feedbackMultiplier: row.feedbackMultiplier,\n    priorityScore: row.priorityScore,",
    "purchase-v2-feedback-fingerprint",
  );
  return next;
});

await edit("src/lib/inventoryLifecycleLedger.ts", (source) => {
  let next = source;
  if (!next.includes("export function buildExactInventory")) {
    next = replaceOnce(
      next,
      "function buildExactInventory(input: {",
      "export function buildExactInventory(input: {",
      "inventory-build-export",
    );
  }

  if (next.includes("grouped.set(key, current as never)")) {
    const start = next.indexOf("function receiptDeltas(rows: StoredOperationRow[]) {");
    const end = next.indexOf("\nfunction overlapMs(", start);
    if (start < 0 || end < 0) throw new Error("RECEIPT_DELTAS_BOUNDARY_MISSING");
    const replacement = `function receiptDeltas(rows: StoredOperationRow[]) {\n  const grouped = new Map<\n    string,\n    NonNullable<ReturnType<typeof parseChinaEvent>>[]\n  >();\n  for (const row of rows) {\n    const event = parseChinaEvent(row);\n    if (!event) continue;\n    const key = \`${"${event.sourceSystem}"}\\u0000${"${event.sourceLineId}"}\\u0000${"${event.barcode}"}\`;\n    const current = grouped.get(key) ?? [];\n    current.push(event);\n    grouped.set(key, current);\n  }\n\n  const deltas: ReceiptDelta[] = [];\n  for (const events of grouped.values()) {\n    events.sort(\n      (left, right) =>\n        Date.parse(left.occurredAt) - Date.parse(right.occurredAt),\n    );\n    let requested = 0;\n    let ordered = 0;\n    let received = 0;\n    let cancelled = 0;\n    for (const event of events) {\n      requested = Math.max(requested, event.requestedQuantity ?? requested);\n      ordered = Math.max(ordered, event.orderedQuantity ?? ordered);\n      const committed = Math.max(requested, ordered);\n      if (event.cancelledQuantity !== null) {\n        cancelled = Math.max(cancelled, event.cancelledQuantity);\n      }\n      let nextReceived = received;\n      if (event.receivedQuantity !== null) {\n        nextReceived = Math.max(nextReceived, event.receivedQuantity);\n      }\n      if (event.status === "RECEIVED" && event.receivedQuantity === null) {\n        nextReceived = Math.max(nextReceived, committed - cancelled);\n      }\n      nextReceived = Math.min(committed, nextReceived);\n      const delta = Math.max(0, nextReceived - received);\n      if (delta > 0) {\n        deltas.push({\n          barcode: event.barcode,\n          occurredAt: event.occurredAt,\n          quantity: delta,\n          sourceLineId: \`${"${event.sourceSystem}"}:${"${event.sourceLineId}"}\`,\n        });\n      }\n      received = nextReceived;\n    }\n  }\n  return deltas;\n}\n`;
    next = next.slice(0, start) + replacement + next.slice(end);
  }

  next = replaceOnce(
    next,
    "  pendingJobId: string | null;\n  reason: string;",
    "  pendingJobId: string | null;\n  pendingDesiredStatus: ShoplingInventoryDesiredStatus | null;\n  reason: string;",
    "inventory-pending-desired-type",
  );

  const oldPending = `      const latestSync = relatedSync.at(-1) ?? null;\n      const successfulSync = [...relatedSync]\n        .reverse()\n        .find((event) => event.state === "SUCCEEDED") ?? null;\n      const latestPending = [...relatedSync]\n        .reverse()\n        .find(\n          (event) =>\n            event.state === "PENDING" || event.state === "RUNNING",\n        ) ?? null;`;
  const newPending = `      const latestSync = relatedSync.at(-1) ?? null;\n      const latestByJob = new Map<string, SyncEvent>();\n      for (const event of relatedSync) latestByJob.set(event.jobId, event);\n      const latestJobEvents = [...latestByJob.values()].sort(\n        (left, right) =>\n          Date.parse(left.occurredAt) - Date.parse(right.occurredAt),\n      );\n      const successfulSync = [...latestJobEvents]\n        .reverse()\n        .find((event) => event.state === "SUCCEEDED") ?? null;\n      const latestPending = [...latestJobEvents]\n        .reverse()\n        .find(\n          (event) =>\n            event.state === "PENDING" || event.state === "RUNNING",\n        ) ?? null;`;
  next = replaceOnce(
    next,
    oldPending,
    newPending,
    "inventory-latest-job-state",
  );
  next = replaceOnce(
    next,
    "        pendingJobId: latestPending?.jobId ?? null,\n        reason: reset.reason,",
    "        pendingJobId: latestPending?.jobId ?? null,\n        pendingDesiredStatus: latestPending?.desiredStatus ?? null,\n        reason: reset.reason,",
    "inventory-pending-desired-row",
  );
  return next;
});

await edit("src/app/api/inventory-lifecycle/route.ts", (source) => {
  let next = source;
  if (next.includes("const mode = productMode(body.productMode);")) {
    next = next.replace(
      `function productMode(value: unknown): ShoplingInventoryProductMode {\n  return text(value).toUpperCase() === "SINGLE" ? "SINGLE" : "OPTION";\n}`,
      `function productMode(value: unknown): ShoplingInventoryProductMode | null {\n  const normalized = text(value).toUpperCase();\n  if (normalized === "SINGLE" || normalized === "OPTION") return normalized;\n  return null;\n}`,
    );
    next = next.replace(
      "    const mode = productMode(body.productMode);\n    const modelNo",
      "    const requestedMode = productMode(body.productMode);\n    const modelNo",
    );
    next = next.replace(
      `    if (action === "STOCKOUT") {\n      const reset`,
      `    if (action === "STOCKOUT") {\n      if (!requestedMode) throw new Error("INVENTORY_PRODUCT_MODE_REQUIRED");\n      const mode = requestedMode;\n      const reset`,
    );
    next = next.replace(
      "        productMode: mode || row.productMode,",
      "        productMode: requestedMode ?? row.productMode,",
    );
    next = next.replace(
      "        productMode: mode,\n        desiredStatus: desiredStatus as",
      '        productMode: requestedMode ?? "OPTION",\n        desiredStatus: desiredStatus as',
    );
  }
  return next;
});

await edit(
  "src/app/api/shopling-inventory-lifecycle-extension/download/route.ts",
  (source) => {
    let next = source.replaceAll("v0.1.0", "v0.1.1");
    if (next.includes("return new Response(zip, {")) {
      next = next.replace(
        "return new Response(zip, {",
        "return new Response(new Uint8Array(zip), {",
      );
    }
    return next;
  },
);

await edit("public/shopling-inventory-lifecycle/content-shopling.js", (source) => {
  let next = source.replaceAll('"0.1.0"', '"0.1.1"');
  next = next.replace("  const handled = new Set();\n", "");
  next = next.replace("    if (handled.has(key)) return;\n", "");
  next = next.replace("    let actionable = false;\n", "");
  next = next.replace(/\n\s*actionable = true;/g, "");
  next = next.replace("\n    if (actionable) handled.add(key);", "");
  if (!next.includes("const inFlight = new Set();")) {
    next = next.replace(
      "  const attempts = new Map();",
      "  const attempts = new Map();\n  const inFlight = new Set();",
    );
  }
  next = next.replace(
    `  async function drive(job, currentRole) {\n    if (!job || job.status !== "RUNNING") return;\n    const key = \`${"${job.jobId}"}:${"${job.stage}"}:${"${currentRole}"}:${"${location.href}"}\`;`,
    `  async function drive(job, currentRole) {\n    if (!job || job.status !== "RUNNING") return;\n    const key = \`${"${job.jobId}"}:${"${job.stage}"}:${"${currentRole}"}:${"${location.href}"}\`;\n    if (inFlight.has(key)) return;\n    inFlight.add(key);\n    try {`,
  );
  next = next.replace(
    `    } else if (job.stage === "NAVIGATE_A22" && currentRole === "MENU") {`,
    `    } else if (\n      job.stage === "NAVIGATE_A22" &&\n      ["MENU", "A6", "A21_LIST", "A22"].includes(currentRole)\n    ) {`,
  );
  next = next.replace(
    `    } else if (job.stage === "NAVIGATE_A21" && currentRole === "MENU") {`,
    `    } else if (\n      job.stage === "NAVIGATE_A21" &&\n      ["MENU", "A6", "A21_LIST", "A22"].includes(currentRole)\n    ) {`,
  );
  const driveEnd = `    } else if (job.stage === "A21_RESULT" && ["A21_RESULT", "RESULT_PROCESSING"].includes(currentRole)) {\n      await handleA21Result(job);\n    }\n  }`;
  const driveEndReplacement = `    } else if (job.stage === "A21_RESULT" && ["A21_RESULT", "RESULT_PROCESSING"].includes(currentRole)) {\n      await handleA21Result(job);\n    }\n    } finally {\n      setTimeout(() => inFlight.delete(key), 500);\n    }\n  }`;
  next = replaceOnce(next, driveEnd, driveEndReplacement, "extension-drive-finally");
  next = next.replaceAll(
    "/상품옵션\\s*(수정\\s*)?전송이\\s*완료되었습니다",
    "/상품\\s*옵션\\s*(수정\\s*)?전송이\\s*완료되었습니다",
  );
  next = next.replaceAll(
    "/상품옵션\\s*전송\\s*완료",
    "/상품\\s*옵션\\s*전송\\s*완료",
  );
  if (/\bhandled\b|\bactionable\b/.test(next)) {
    throw new Error("EXTENSION_STALE_HANDLED_LOGIC");
  }
  return next;
});

for (const file of [
  "public/shopling-inventory-lifecycle/background.js",
  "public/shopling-inventory-lifecycle/content-ops.js",
]) {
  await edit(file, (source) => source.replaceAll('"0.1.0"', '"0.1.1"'));
}
await edit("public/shopling-inventory-lifecycle/manifest.json", (source) =>
  source.replace('"version": "0.1.0"', '"version": "0.1.1"'),
);
await edit("public/shopling-inventory-lifecycle/popup.html", (source) =>
  source.replace("COMMERCE OS · v0.1.0", "COMMERCE OS · v0.1.1"),
);
await edit("public/shopling-inventory-lifecycle/README.txt", (source) =>
  source.replace("v0.1.0", "v0.1.1"),
);

await edit("src/components/china-order-manager/PurchaseV2Workspace.tsx", (source) => {
  let next = source;
  next = next.replace(
    'import { useEffect, useMemo, useState } from "react";',
    'import { useEffect, useMemo, useRef, useState } from "react";',
  );
  next = replaceOnce(
    next,
    "  pendingJobId: string | null;\n};",
    "  pendingJobId: string | null;\n  pendingDesiredStatus: \"SOLD_OUT\" | \"SELLING\" | null;\n};",
    "workspace-pending-desired-type",
  );
  next = replaceOnce(
    next,
    "  const [extensionReady, setExtensionReady] = useState(false);",
    "  const [extensionReady, setExtensionReady] = useState(false);\n  const automaticRestoreStarted = useRef(new Set<string>());",
    "workspace-auto-restore-ref",
  );
  next = next.replace(
    "  async function restore(row: InventoryLifecycleClientRow) {\n    const accepted = window.confirm(",
    "  async function restore(\n    row: InventoryLifecycleClientRow,\n    requireConfirmation = true,\n  ) {\n    const accepted =\n      !requireConfirmation ||\n      window.confirm(",
  );
  next = next.replace(
    "    if (!accepted) return;\n    setLoading(true);",
    "    if (!accepted) return;\n    setLoading(true);",
  );
  const returnAnchor = "\n  return (\n    <div className=\"space-y-6\">";
  if (!next.includes("automaticRestoreStarted.current.has")) {
    const effect = `\n  function resumePending(row: InventoryLifecycleClientRow) {\n    if (!row.pendingJobId || !row.pendingDesiredStatus) return;\n    runExtension({\n      jobId: row.pendingJobId,\n      barcode: row.barcode,\n      modelNo: row.modelNo,\n      productName: row.productName,\n      productMode: row.productMode,\n      desiredStatus: row.pendingDesiredStatus,\n      state: "PENDING",\n      stage: "QUEUED",\n    });\n  }\n\n  useEffect(() => {\n    if (!extensionReady || loading) return;\n    const candidate = lifecycle.rows.find(\n      (row) =>\n        row.nextRecommendedSync === "SELLING" &&\n        !row.pendingJobId &&\n        row.exactInventoryKnown &&\n        (row.exactInventoryQuantity ?? 0) > 0 &&\n        !automaticRestoreStarted.current.has(row.barcode),\n    );\n    if (!candidate) return;\n    automaticRestoreStarted.current.add(candidate.barcode);\n    void restore(candidate, false);\n  }, [extensionReady, lifecycle.rows, loading]);\n`;
    next = replaceOnce(
      next,
      returnAnchor,
      `${effect}${returnAnchor}`,
      "workspace-auto-restore-effect",
    );
  }
  next = next.replace(
    `                      <button type="button" onClick={() => restore(row)} disabled={loading} className="rounded-lg bg-emerald-600 px-3 py-2 font-black text-white disabled:bg-slate-400">입고확정 · 판매중 복구</button>`,
    `                      <button type="button" onClick={() => restore(row, true)} disabled={loading} className="rounded-lg bg-emerald-600 px-3 py-2 font-black text-white disabled:bg-slate-400">입고확정 · 판매중 복구</button>`,
  );
  next = next.replace(
    `                    ) : row.pendingJobId ? (\n                      <span className="font-bold text-amber-700">외부반영 대기</span>`,
    `                    ) : row.pendingJobId && row.pendingDesiredStatus ? (\n                      <button type="button" onClick={() => resumePending(row)} disabled={loading} className="rounded-lg bg-amber-600 px-3 py-2 font-black text-white disabled:bg-slate-400">외부반영 대기 · 실행</button>`,
  );
  return next;
});

await edit("src/app/china-order-manager/purchase-v2/page.tsx", (source) =>
  source.replace(
    "      initialReport={report}",
    "      initialReport={finalized?.report ?? report}",
  ),
);

await edit("src/app/china-order-manager/cash-envelope/page.tsx", () =>
  `import { redirect } from "next/navigation";\n\nexport default function LegacyCashEnvelopeRedirect() {\n  redirect("/china-order-manager/purchase-v2");\n}\n`,
);

await edit("src/components/china-order-manager/ChinaOrderManagerNav.tsx", (source) => {
  if (source.includes('/china-order-manager/purchase-v2')) return source;
  const link = `\n        <a\n          href="/china-order-manager/purchase-v2"\n          className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-black text-blue-900 hover:bg-blue-100"\n        >\n          발주 V2 · 품절/판매중\n        </a>`;
  const navClose = source.lastIndexOf("</nav>");
  if (navClose >= 0) {
    return source.slice(0, navClose) + link + "\n      " + source.slice(navClose);
  }
  const divClose = source.lastIndexOf("</div>");
  if (divClose >= 0) {
    return source.slice(0, divClose) + link + "\n      " + source.slice(divClose);
  }
  throw new Error("CHINA_ORDER_MANAGER_NAV_INSERTION_POINT_NOT_FOUND");
});

await edit(".github/workflows/purchase-v2-stockout-lifecycle-ci.yml", (source) => {
  let next = source;
  const old = `      - name: Apply deterministic finalizers\n        run: |\n          node scripts/finalize-purchase-v2-branch.mjs\n          node scripts/finalize-purchase-v2-branch-2.mjs`;
  const replacement = `      - name: Apply deterministic finalizer\n        run: node scripts/finalize-purchase-v2-branch-3.mjs`;
  if (next.includes(old)) next = next.replace(old, replacement);
  if (!next.includes("finalize-purchase-v2-branch-3.mjs")) {
    throw new Error("PURCHASE_V2_WORKFLOW_FINALIZER_PATCH_FAILED");
  }
  next = next.replace(
    "tests/shoplingInventoryLifecycleExtension.test.mjs\n",
    "tests/shoplingInventoryLifecycleExtension.test.mjs\n          tests/purchaseV2Feedback.test.mjs\n",
  );
  return next;
});

console.log("PURCHASE_V2_BRANCH_FINALIZER_3_OK");
