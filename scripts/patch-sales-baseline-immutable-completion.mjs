import { readFile, writeFile, unlink } from "node:fs/promises";

const workflowPath = "src/lib/productMasterShoplingSalesBackfill.ts";
const testPath = "tests/productMasterShoplingSalesBackfill.test.mjs";
const tempWorkflowPath = ".github/workflows/temporary-sales-baseline-immutable-completion-patch.yml";
const selfPath = "scripts/patch-sales-baseline-immutable-completion.mjs";

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`PATCH_SOURCE_MISSING:${label}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`PATCH_NO_CHANGE:${label}`);
  return next;
}

let source = await readFile(workflowPath, "utf8");

source = replaceOnce(
  source,
`  const [chunks, failures, failedRuns, reports, canaries] = await Promise.all([
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_CHUNK, cid),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_STEP_FAILURE, cid),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_FAILED, cid, 5),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_REPORT, cid, 5),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_CANARY, cid, 5),
  ]);
  return { request, cid, chunks, failures, failedRuns, reports, canaries };
`,
`  const [chunks, failures, failedRuns, reports, canaries, fullRuns] =
    await Promise.all([
      readOperations(PRODUCT_MASTER_SHOPLING_SALES_CHUNK, cid),
      readOperations(PRODUCT_MASTER_SHOPLING_SALES_STEP_FAILURE, cid),
      readOperations(PRODUCT_MASTER_SHOPLING_SALES_FAILED, cid, 5),
      readOperations(PRODUCT_MASTER_SHOPLING_SALES_REPORT, cid, 5),
      readOperations(PRODUCT_MASTER_SHOPLING_SALES_CANARY, cid, 5),
      readOperations(PRODUCT_MASTER_SHOPLING_SALES_FULL, cid, 5),
    ]);
  return {
    request,
    cid,
    chunks,
    failures,
    failedRuns,
    reports,
    canaries,
    fullRuns,
  };
`,
  "load full apply operations",
);

source = replaceOnce(
  source,
`function canaryVerified(
  context: NonNullable<Awaited<ReturnType<typeof activeContext>>>,
) {
  return context.canaries.some(
    (row) =>
      text(row.status) === "SUCCEEDED" &&
      object(row.result_snapshot).verified === true,
  );
}
`,
`function canaryVerified(
  context: NonNullable<Awaited<ReturnType<typeof activeContext>>>,
) {
  return context.canaries.some(
    (row) =>
      text(row.status) === "SUCCEEDED" &&
      object(row.result_snapshot).verified === true,
  );
}

function fullApplyVerified(
  context: NonNullable<Awaited<ReturnType<typeof activeContext>>>,
) {
  return context.fullRuns.some((row) => {
    const result = object(row.result_snapshot);
    return (
      text(row.status) === "SUCCEEDED" &&
      result.verified === true &&
      Math.max(0, Math.round(number(result.pendingCount))) === 0 &&
      Math.max(0, Math.round(number(result.blockerCount))) === 0
    );
  });
}
`,
  "add immutable full apply milestone",
);

source = replaceOnce(
  source,
`  const selected = mode === "CANARY" ? plan.pending.slice(0, 1) : plan.pending;
  if (!selected.length) {
    return {
      mode,
      applied: 0,
      verified: true,
      status: await loadProductMasterShoplingSalesStatus(),
    };
  }
`,
`  const selected = mode === "CANARY" ? plan.pending.slice(0, 1) : plan.pending;
  if (!selected.length) {
    if (mode === "FULL" && canaryVerified(context)) {
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_FULL,
        sourceEventId: \`product-master-shopling-sales-full:\${context.request.requestId}\`,
        correlationId: context.cid,
        inputSnapshot: {
          requestId: context.request.requestId,
          mode,
          selectedCount: 0,
        },
        resultSnapshot: {
          verified: true,
          written: 0,
          pendingCount: 0,
          blockerCount: 0,
        },
      });
    }
    return {
      mode,
      applied: 0,
      verified: true,
      status: await loadProductMasterShoplingSalesStatus(),
    };
  }
`,
  "persist zero-pending full completion milestone",
);

source = replaceOnce(
  source,
`  try {
    const plan = await currentApplyPlan(context);
    const verified = canaryVerified(context);
`,
`  const verified = canaryVerified(context);
  if (fullApplyVerified(context)) {
    return {
      ...empty,
      ...common,
      progress: 100,
      completedRanges: totalRanges,
      report,
      state: "COMPLETED",
      stage: "판매원장 기준선 적재 완료",
      message: \`최초 Shopling 월 판매원장 \${report.monthlyRowCount}건은 전수 적재·재검증이 완료되었습니다. 이후 증분 동기화가 같은 원장 ID를 최신값으로 갱신해도 기준선 완료 상태는 유지됩니다.\`,
      safeRowCount: report.monthlyRowCount,
      alreadyAppliedCount: report.monthlyRowCount,
      pendingCount: 0,
      blockerCount: 0,
      canaryVerified: verified,
    };
  }

  try {
    const plan = await currentApplyPlan(context);
`,
  "keep verified baseline completion immutable",
);

await writeFile(workflowPath, source);

let testSource = await readFile(testPath, "utf8");
testSource += `\n\ntest("verified full baseline remains completed after rolling incremental values change", () => {\n  assert.match(workflow, /readOperations\\(PRODUCT_MASTER_SHOPLING_SALES_FULL, cid, 5\\)/);\n  assert.match(workflow, /function fullApplyVerified/);\n  assert.match(workflow, /result\\.verified === true/);\n  assert.match(workflow, /result\\.pendingCount/);\n  assert.match(workflow, /result\\.blockerCount/);\n  assert.match(workflow, /if \\(fullApplyVerified\\(context\\)\\)/);\n  assert.match(workflow, /이후 증분 동기화가 같은 원장 ID를 최신값으로 갱신해도 기준선 완료 상태는 유지됩니다/);\n});\n\ntest("zero-pending full apply still records the immutable completion milestone", () => {\n  assert.match(workflow, /mode === \\"FULL\\" && canaryVerified\\(context\\)/);\n  assert.match(workflow, /selectedCount: 0/);\n  assert.match(workflow, /operationType: PRODUCT_MASTER_SHOPLING_SALES_FULL/);\n});\n`;
await writeFile(testPath, testSource);

await unlink(tempWorkflowPath).catch(() => undefined);
await unlink(selfPath).catch(() => undefined);
