import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function importBulkInput() {
  const sourceName = "shoplingPriceModifyBulkInput.ts";
  const source = (await read(`src/lib/${sourceName}`)).replace('"fflate"', JSON.stringify(import.meta.resolve("fflate")));
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceName,
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}`);
}

async function importOpsModule() {
  const inputSource = (await read("src/lib/shoplingPriceModifyBulkInput.ts")).replace('"fflate"', JSON.stringify(import.meta.resolve("fflate")));
  const inputOutput = ts.transpileModule(inputSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "shoplingPriceModifyBulkInput.ts",
  }).outputText;
  const inputUrl = `data:text/javascript;base64,${Buffer.from(inputOutput).toString("base64")}`;
  const opsSource = (await read("src/lib/shoplingPriceModifyBulkOps.ts")).replace('"@/lib/shoplingPriceModifyBulkInput"', JSON.stringify(inputUrl));
  const opsOutput = ts.transpileModule(opsSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "shoplingPriceModifyBulkOps.ts",
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(opsOutput).toString("base64")}`);
}

const { parseShoplingPriceBulkPaste, plannedShoplingPriceBulkChunkCount } = await importBulkInput();
const {
  calculateShoplingPriceBulkTiming,
  createShoplingPriceBulkItemsCsv,
  createShoplingPriceBulkSyntheticInput,
  runShoplingPriceBulkLocalBenchmark,
} = await importOpsModule();

test("005 migration adds validation-only jobs, 401 chunks, audit, and archive without hard delete", async () => {
  const sql = await read("supabase/migrations/202607280001_shopling_price_bulk_ops_observability.sql");
  for (const phrase of [
    "validation_only",
    "execution_mode text not null default 'live'",
    "shopling_price_bulk_audit_events",
    "create_shopling_price_bulk_validation_job",
    "generate_series(1, p_count)",
    "990000000000::bigint + ordinal",
    "archive_shopling_price_bulk_job",
    "restore_shopling_price_bulk_job",
    "archive_stale_shopling_price_bulk_jobs",
    "enable row level security",
    "service_role",
  ]) assert.match(sql, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(sql, /p_count <> 20000/);
  assert.match(sql, /v_chunk_count := 1 \+ ceil\(greatest\(p_count - 10, 0\) \/ 50\.0\)/);
  assert.match(sql, /owner_id,\s*status,\s*input_source,[\s\S]*?values \(\s*p_owner_id,\s*'validation_only',\s*'validation_only'/);
  assert.match(sql, /execution_mode\s*\) values \([\s\S]*?'validation_only'\s*\) returning/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.shopling_price_bulk_/i);
  assert.doesNotMatch(sql, /policy_overrides[^\n]+metadata/i);
  assert.doesNotMatch(sql, /result_summary[^\n]+metadata/i);
});

test("validation-only status cannot satisfy live canary, normal, or retry reservation contracts", async () => {
  const [canarySql, normalSql, retrySql] = await Promise.all([
    read("supabase/migrations/202607260002_shopling_price_bulk_canary.sql"),
    read("supabase/migrations/202607260003_shopling_price_bulk_normal_serial.sql"),
    read("supabase/migrations/202607270001_shopling_price_bulk_retry_recovery.sql"),
  ]);
  assert.match(canarySql, /status\s*<>\s*'prepared'|status\s*=\s*'prepared'/);
  assert.match(normalSql, /status\s*<>\s*'canary_succeeded'|status\s*=\s*'canary_succeeded'/);
  assert.match(retrySql, /status not in \('canary_failed', 'normal_failed', 'retry_failed'\)/);
  for (const sql of [canarySql, normalSql, retrySql]) assert.doesNotMatch(sql, /validation_only/);
});

test("actual 20,000 parser and planner benchmark returns exact safe counts", () => {
  const input = createShoplingPriceBulkSyntheticInput(20_000);
  const parsed = parseShoplingPriceBulkPaste(input);
  assert.equal(parsed.validCount, 20_000);
  assert.equal(parsed.duplicateCount, 0);
  assert.equal(parsed.invalidCount, 0);
  assert.equal(plannedShoplingPriceBulkChunkCount(parsed.validCount), 401);
  const times = [100, 125.5];
  const benchmark = runShoplingPriceBulkLocalBenchmark(() => times.shift());
  assert.deepEqual({
    passed: benchmark.passed,
    elapsed_ms: benchmark.elapsed_ms,
    valid_count: benchmark.valid_count,
    duplicate_count: benchmark.duplicate_count,
    invalid_count: benchmark.invalid_count,
    planned_chunk_count: benchmark.planned_chunk_count,
    estimated_mall_rows: benchmark.estimated_mall_rows,
  }, {
    passed: true,
    elapsed_ms: 25.5,
    valid_count: 20_000,
    duplicate_count: 0,
    invalid_count: 0,
    planned_chunk_count: 401,
    estimated_mall_rows: 480_000,
  });
});

test("active timing advances beyond a completed earlier chunk while terminal timing stops", () => {
  const chunks = [{
    chunk_index: 0,
    chunk_type: "canary",
    status: "succeeded",
    goods_key_count: 10,
    attempt_count: 1,
    started_at: "2026-07-28T00:00:00.000Z",
    completed_at: "2026-07-28T00:00:10.000Z",
  }];
  const active = calculateShoplingPriceBulkTiming(
    { status: "normal_running", created_at: "2026-07-27T23:59:00.000Z", updated_at: "2026-07-28T00:00:20.000Z" },
    chunks,
    10,
    () => Date.parse("2026-07-28T00:01:00.000Z"),
  );
  const terminal = calculateShoplingPriceBulkTiming(
    { status: "normal_succeeded", created_at: "2026-07-27T23:59:00.000Z", updated_at: "2026-07-28T00:01:00.000Z" },
    chunks,
    10,
    () => Date.parse("2026-07-28T00:02:00.000Z"),
  );
  assert.equal(active.elapsed_seconds, 60);
  assert.equal(terminal.elapsed_seconds, 10);
});

test("CSV export has UTF-8 BOM, quoting, and control-whitespace formula neutralization", () => {
  const csv = createShoplingPriceBulkItemsCsv("job-1", "live", "normal_failed", [{
    goods_key: "121031",
    ordinal: 1,
    status: "failed",
    attempt_count: 2,
    last_error: '\t=HYPERLINK("https://example.invalid","x"),\r\nretry',
  }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /job_id,execution_mode,job_status,goods_key,ordinal,item_status,attempt_count,last_error/);
  assert.ok(csv.includes("'\t=HYPERLINK"));
  assert.match(csv, /""https:\/\/example\.invalid""/);
});

test("validation-only API is session-owned and has no external execution path", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/validation-jobs/route.ts");
  assert.match(route, /CONFIRM_20000_VALIDATION_ONLY/);
  assert.match(route, /p_owner_id: auth\.ownerId/);
  assert.match(route, /p_count: 20_000/);
  assert.match(route, /VALIDATION_JOB_EMPTY/);
  assert.doesNotMatch(route, /goods_keys/);
  assert.doesNotMatch(route, /shoplingPriceModifyRunner/);
  assert.doesNotMatch(route, /dispatch/);
  assert.doesNotMatch(route, /fetch\s*\(/);
});

test("report uses stable cursor pagination, summary counts, and safe bounded output", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/report/route.ts");
  assert.match(route, /MAX_ITEMS = 20_000/);
  assert.match(route, /MAX_CHUNKS = 2_000/);
  assert.match(route, /if \(lastOrdinal > 0\) query = query\.gt\("ordinal", lastOrdinal\)/);
  assert.match(route, /order\("ordinal", \{ ascending: true \}\)\.limit\(pageLimit\)/);
  assert.match(route, /summaryOnly/);
  assert.match(route, /count: "exact", head: true/);
  assert.match(route, /format === "csv"/);
  assert.match(route, /content-disposition/);
  assert.doesNotMatch(route, /policy_overrides[^\n]+response/i);
  assert.doesNotMatch(route, /result_summary/);
  assert.doesNotMatch(route, /Authorization|apikey|SUPABASE_SECRET/);
});

test("audit and archive APIs are owner scoped, bounded, and confirmation gated", async () => {
  const [audit, archive, restore, stale] = await Promise.all([
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/audit/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/archive/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/restore/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/archive-stale/route.ts"),
  ]);
  assert.match(audit, /MAX_EVENTS = 1000/);
  assert.match(audit, /before_id/);
  assert.match(audit, /owner_id", auth\.ownerId/);
  assert.match(archive, /CONFIRM_BULK_ARCHIVE/);
  assert.match(archive, /p_owner_id: auth\.ownerId/);
  assert.match(restore, /CONFIRM_BULK_RESTORE/);
  assert.match(stale, /CONFIRM_ARCHIVE_STALE_PREPARED/);
  assert.match(stale, /new Set\(\[7, 14, 30, 60, 90\]\)/);
});

test("operations UI synchronizes job changes, preserves audit downloads, and keeps immediate runner", async () => {
  const [ui, page, inputUi] = await Promise.all([
    read("src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkOperations.tsx"),
    read("src/app/shopling-price-modify-runner/page.tsx"),
    read("src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx"),
  ]);
  for (const phrase of [
    "운영 검증·관측·정리",
    "운영 리포트 JSON 다운로드",
    "상품 결과 CSV 다운로드",
    "감사 로그 보기",
    "20,000개 가격 무쓰기 부하검증",
    "가격 실행 잠금",
    "작업 보관",
    "보관 해제",
    "오래된 준비·검증 작업 보관",
  ]) assert.match(ui, new RegExp(phrase));
  assert.match(ui, /format=json&summary=1/);
  assert.match(ui, /setAudit\(\[\]\)/);
  assert.match(ui, /setAudit\(events\)/);
  assert.match(ui, /audit\.slice\(0, 100\)/);
  assert.match(ui, /window\.location\.assign/);
  assert.match(ui, /window\.location\.reload/);
  assert.match(page, /ShoplingPriceModifyBulkOperations/);
  assert.match(page, /<ShoplingPriceModifyRunner \/>/);
  assert.match(inputUi, /일반 상품 직렬 실행 승인/);
  assert.match(inputUi, /실패 상품 .*개만 재실행 승인/);
  assert.doesNotMatch(ui, /setInterval/);
});

test("Supabase admin REST client emits lt, is-null, and not-null filters", async () => {
  const { createSupabaseAdminClient } = await importTranspiledTypeScript(new URL("../src/lib/supabase/admin.ts", import.meta.url));
  const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, secret: process.env.SUPABASE_SECRET_KEY, fetch: globalThis.fetch };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "legacy.service-role.secret";
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(new URL(String(url))); return new Response("[]", { status: 200 }); };
  try {
    const admin = await createSupabaseAdminClient();
    await admin.from("events").select().lt("id", 100).order("id", { ascending: false }).limit(10);
    await admin.from("jobs").select().is("archived_at", null).limit(10);
    await admin.from("jobs").select().not("archived_at", "is", null).limit(20);
    assert.equal(urls[0].searchParams.get("id"), "lt.100");
    assert.equal(urls[1].searchParams.get("archived_at"), "is.null");
    assert.equal(urls[2].searchParams.get("archived_at"), "not.is.null");
  } finally {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.secret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previous.secret;
    globalThis.fetch = previous.fetch;
  }
});
