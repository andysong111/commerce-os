import { after, NextRequest } from "next/server";
import { validate1688Url } from "@/lib/keywordEngineElonLabV2";
import { readProductLaunchNormalizedItems } from "@/lib/productLaunchTrackerNormalizedStore";
import { requireSeoTitleLedgerContext } from "@/lib/seoTitleLedgerServer";
import {
  archiveSeoRunJobs,
  insertSeoRunJobs,
  listSeoRunJobs,
  patchOwnedSeoRunJobs,
  retrySeoRunJobs,
  type SeoRunJobInsert,
} from "@/lib/seoRunJobServer";
import { processSeoRunQueue } from "@/lib/seoRunWorker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ENQUEUE_RUNS = 50;
const CUSTOM_BLOCKED_LIMIT = 200;

type UnknownRecord = Record<string, unknown>;

type RequestedRun = {
  runId: string;
  itemId: string;
  batchId: string;
  runCreatedAt: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function stringList(value: unknown, limit = 200) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = text(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeRunId(value: unknown) {
  const normalized = text(value);
  return /^seo-run-[A-Za-z0-9-]{8,160}$/.test(normalized) ? normalized : "";
}

function normalizeBatchId(value: unknown) {
  const normalized = text(value);
  return /^seo-bulk-[A-Za-z0-9-]{8,160}$/.test(normalized)
    ? normalized
    : `seo-bulk-${crypto.randomUUID()}`;
}

function normalizeRequestedRuns(value: unknown, fallbackBatchId: string) {
  const result: RequestedRun[] = [];
  const seen = new Set<string>();
  for (const entry of array(value)) {
    const row = record(entry);
    const runId = normalizeRunId(row.runId);
    const itemId = text(row.id || row.itemId);
    if (!runId || !itemId || itemId.length > 180 || seen.has(runId)) continue;
    seen.add(runId);
    const parsed = Date.parse(text(row.runCreatedAt));
    result.push({
      runId,
      itemId,
      batchId: normalizeBatchId(row.batchId || fallbackBatchId),
      runCreatedAt: Number.isFinite(parsed)
        ? new Date(parsed).toISOString()
        : new Date().toISOString(),
    });
    if (result.length >= MAX_ENQUEUE_RUNS) break;
  }
  return result;
}

function titleRows(value: unknown) {
  return array(record(value).mallTitles)
    .map(record)
    .map((row) => text(row.title))
    .filter(Boolean);
}

function historicalMallTitles(item: UnknownRecord) {
  const titles = [...titleRows(item.seoFinal)];
  for (const value of array(item.shoplingRegistrationHistory)) {
    const entry = record(value);
    for (const key of [
      "previousSeoFinal",
      "seoFinal",
      "registeredSeoFinal",
      "newSeoFinal",
    ]) {
      titles.push(...titleRows(entry[key]));
    }
  }
  return titles;
}

function resultMallTitles(value: unknown) {
  const payload = record(value);
  return titleRows(payload.seoFinal || record(payload.result).seoFinal);
}

function optionText(item: UnknownRecord) {
  return array(item.orderOptions)
    .map(record)
    .map((row) =>
      [row.saleOption, row.chinaOption, row.optionName, row.barcode]
        .map(text)
        .filter(Boolean)
        .join(" / "),
    )
    .filter(Boolean)
    .join("\n");
}

function sourceUrl(item: UnknownRecord) {
  const detailPageSource = record(item.detailPageSource);
  const candidates = [
    record(item.seoFinal).sourceUrl,
    item.primaryChinaProductLink,
    detailPageSource.primaryUrl,
    ...array(item.chinaProductLinks),
    ...array(detailPageSource.urls),
  ];
  for (const value of candidates) {
    const candidate = record(value);
    const url = text(candidate.url || candidate.href || candidate.value || value);
    if (validate1688Url(url)) return url;
  }
  return "";
}

function runIds(value: unknown) {
  return stringList(value, 200).filter((value) => value.length <= 180);
}

export async function GET(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
  const jobs = await listSeoRunJobs(authenticated.value, {
    includeArchived,
    limit: includeArchived ? 1000 : 300,
  });
  return Response.json({ ok: true, jobs });
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const body = record(await request.json().catch(() => ({})));
  const action = text(body.action) || "enqueue";
  const context = authenticated.value;

  if (action === "enqueue") {
    const fallbackBatchId = normalizeBatchId(body.batchId);
    const requested = normalizeRequestedRuns(body.runs, fallbackBatchId);
    if (!requested.length) {
      return Response.json(
        {
          ok: false,
          code: "SEO_RUNS_REQUIRED",
          message: "서버에서 실행할 SEO 등록회차가 없습니다.",
        },
        { status: 400 },
      );
    }
    const itemIds = [...new Set(requested.map((row) => row.itemId))];
    const items = await readProductLaunchNormalizedItems(
      context.config,
      context.identity.userId,
      itemIds,
    );
    const itemById = new Map(items.map((item) => [text(item.id), item]));
    const existing = await listSeoRunJobs(context, {
      includeArchived: true,
      launchItemIds: itemIds,
      limit: 1000,
    });
    const serverTitlesByItem = new Map<string, string[]>();
    for (const job of existing) {
      const titles = serverTitlesByItem.get(job.launch_item_id) ?? [];
      titles.push(...resultMallTitles(job.result_payload));
      serverTitlesByItem.set(job.launch_item_id, titles);
    }
    const customBlockedTerms = stringList(
      body.customBlockedTerms,
      CUSTOM_BLOCKED_LIMIT,
    );
    const rows: SeoRunJobInsert[] = [];
    const missing: string[] = [];
    for (const run of requested) {
      const item = itemById.get(run.itemId);
      if (!item) {
        missing.push(run.itemId);
        continue;
      }
      const url = sourceUrl(item);
      if (!url) {
        missing.push(`${text(item.modelNumber) || run.itemId}:1688링크`);
        continue;
      }
      const category = text(item.shoplingCategory);
      const exclusions = [
        ...historicalMallTitles(item),
        ...(serverTitlesByItem.get(run.itemId) ?? []),
      ];
      rows.push({
        run_id: run.runId,
        batch_id: run.batchId,
        launch_item_id: run.itemId,
        tracker_row_number: Number(item.trackerRowNumber) || null,
        model_number: text(item.modelNumber),
        product_name: text(item.productName),
        source_url: url,
        run_created_at: run.runCreatedAt,
        input_payload: {
          launchItemId: run.itemId,
          modelNumber: text(item.modelNumber),
          productName: text(item.productName),
          sourceUrl: url,
          optionText: optionText(item),
          supportingText: [category, text(item.productName), text(item.modelNumber)]
            .filter(Boolean)
            .join(" · "),
          mallTitleCategory: category,
          customBlockedTerms,
          variationSeed: run.runId,
          excludedMallTitles: [...new Set(exclusions)].slice(0, 1200),
        },
      });
    }
    if (!rows.length) {
      return Response.json(
        {
          ok: false,
          code: "SEO_RUN_ITEMS_NOT_READY",
          message: `등록회차를 만들 수 없습니다: ${missing.slice(0, 10).join(", ")}`,
        },
        { status: 422 },
      );
    }
    const inserted = await insertSeoRunJobs(context, rows);
    const jobs = await listSeoRunJobs(context, {
      runIds: rows.map((row) => row.run_id),
      includeArchived: true,
      limit: rows.length,
    });
    after(async () => {
      await processSeoRunQueue({
        workerId: `enqueue:${context.identity.userId.slice(0, 8)}:${crypto.randomUUID()}`,
        maxJobs: Math.min(2, rows.length),
        timeBudgetMs: 240_000,
      }).catch((error) => {
        console.error("[seo-run-enqueue] background worker failed", error);
      });
    });
    return Response.json({
      ok: true,
      requestedCount: requested.length,
      insertedCount: inserted.length,
      existingCount: Math.max(0, jobs.length - inserted.length),
      missing,
      jobs,
    });
  }

  if (action === "retry") {
    const ids = runIds(body.runIds);
    const jobs = await retrySeoRunJobs(context, ids);
    after(async () => {
      await processSeoRunQueue({
        workerId: `retry:${context.identity.userId.slice(0, 8)}:${crypto.randomUUID()}`,
        maxJobs: Math.min(2, Math.max(1, ids.length)),
        timeBudgetMs: 240_000,
      }).catch((error) => {
        console.error("[seo-run-retry] background worker failed", error);
      });
    });
    return Response.json({ ok: true, jobs });
  }

  if (action === "archive") {
    const jobs = await archiveSeoRunJobs(context, runIds(body.runIds));
    return Response.json({ ok: true, jobs });
  }

  if (action === "update_registration") {
    const ids = runIds(body.runIds);
    const registrationStatus = text(body.registrationStatus);
    if (
      ![
        "idle",
        "submitting",
        "queued",
        "running",
        "success",
        "failed",
      ].includes(registrationStatus)
    ) {
      return Response.json(
        { ok: false, message: "지원하지 않는 Shopling 등록 상태입니다." },
        { status: 400 },
      );
    }
    const jobs = await patchOwnedSeoRunJobs(context, ids, {
      registration_status: registrationStatus,
      registration_job_id: text(body.registrationJobId).slice(0, 180),
      registration_request_id: text(body.registrationRequestId).slice(0, 180),
      registration_payload: record(body.registrationPayload),
    });
    return Response.json({ ok: true, jobs });
  }

  return Response.json(
    { ok: false, message: `지원하지 않는 SEO RUN 작업입니다: ${action}` },
    { status: 400 },
  );
}
