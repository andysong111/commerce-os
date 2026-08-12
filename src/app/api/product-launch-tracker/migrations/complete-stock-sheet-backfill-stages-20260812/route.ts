import { NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import {
  applyProductLaunchTrackerMutation,
  type ProductLaunchTrackerState,
} from "@/lib/productLaunchTrackerOptimized";

const MIGRATION_KEY = "completeStockSheetBackfillStages20260812";
const SOURCE_IMPORT = "stock-sheet-backfill-20260812";
const WORK_BATCH = "등록완료건";
const EXPECTED_TARGET_COUNT = 284;
const STAGE_KEYS = ["detailPage", "shoplingUpload", "marketRegistration"] as const;

type UnknownRecord = Record<string, unknown>;

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, { requireSameOrigin: false });
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const apply = request.nextUrl.searchParams.get("apply") === "1";

  try {
    const row = (await readProductLaunchState(config.value, identity.value.userId)) as {
      state_payload?: unknown;
    } | null;
    if (!row || !isRecord(row.state_payload)) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_STATE_NOT_FOUND",
          message: "상품출시진행관리 상태를 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const state = row.state_payload as ProductLaunchTrackerState;
    const existingMigration = readMigration(state);
    if (existingMigration?.appliedAt) {
      return Response.json({
        ok: true,
        alreadyApplied: true,
        appliedAt: existingMigration.appliedAt,
        report: existingMigration.report ?? null,
      });
    }

    const items = Array.isArray(state.items) ? state.items.filter(isRecord) : [];
    const targets = items.filter(isTargetItem);
    const targetIds = targets.map((item) => text(item.id)).filter(Boolean);
    const before = Object.fromEntries(
      STAGE_KEYS.map((stageKey) => [
        stageKey,
        {
          completed: targets.filter((item) => stageStatus(item, stageKey) === "완료").length,
          pending: targets.filter((item) => stageStatus(item, stageKey) !== "완료").length,
        },
      ]),
    );
    const report = {
      version: "2026-08-12-stock-sheet-stage-completion-v1",
      sourceImport: SOURCE_IMPORT,
      workBatch: WORK_BATCH,
      expectedTargetCount: EXPECTED_TARGET_COUNT,
      targetCount: targets.length,
      stageKeys: [...STAGE_KEYS],
      before,
      plannedStageUpdates: STAGE_KEYS.reduce(
        (sum, stageKey) => sum + targets.filter((item) => stageStatus(item, stageKey) !== "완료").length,
        0,
      ),
    };

    if (targets.length !== EXPECTED_TARGET_COUNT || targetIds.length !== EXPECTED_TARGET_COUNT) {
      return Response.json(
        {
          ok: false,
          code: "BACKFILL_TARGET_COUNT_MISMATCH",
          message: `방금 등록한 상품 범위가 예상 ${EXPECTED_TARGET_COUNT}건과 일치하지 않아 상태 변경을 중단했습니다.`,
          report,
        },
        { status: 409 },
      );
    }

    if (!apply) return Response.json({ ok: true, dryRun: true, report });

    let nextState = state;
    const changedIds = new Set<string>();
    for (const stageKey of STAGE_KEYS) {
      const mutation = applyProductLaunchTrackerMutation(nextState, {
        operation: "bulk_stage",
        itemIds: targetIds,
        stageKey,
        status: "완료",
        reason: "",
        updatedBy: "승준",
      });
      nextState = mutation.state;
      for (const itemId of mutation.changedIds) changedIds.add(itemId);
    }

    const finalReport = {
      ...report,
      changedItemCount: changedIds.size,
      after: Object.fromEntries(
        STAGE_KEYS.map((stageKey) => [
          stageKey,
          { completed: EXPECTED_TARGET_COUNT, pending: 0 },
        ]),
      ),
    };
    const markedState = markApplied(nextState, finalReport);
    await writeProductLaunchState(
      config.value,
      identity.value,
      markedState as Record<string, unknown>,
    );

    return Response.json({
      ok: true,
      applied: true,
      appliedAt: readMigration(markedState)?.appliedAt,
      changedIds: [...changedIds],
      report: finalReport,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "STOCK_SHEET_STAGE_COMPLETION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "등록완료건 상태 일괄 변경에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}

function isTargetItem(item: UnknownRecord) {
  const source = isRecord(item.source) ? item.source : {};
  return text(source.import) === SOURCE_IMPORT && text(item.workBatch) === WORK_BATCH;
}

function stageStatus(item: UnknownRecord, stageKey: string) {
  const stages = isRecord(item.stages) ? item.stages : {};
  const stage = isRecord(stages[stageKey]) ? stages[stageKey] : {};
  return text(stage.status);
}

function readMigration(state: ProductLaunchTrackerState) {
  const migrations = isRecord(state.serverMigrations) ? state.serverMigrations : {};
  return isRecord(migrations[MIGRATION_KEY])
    ? (migrations[MIGRATION_KEY] as Record<string, unknown>)
    : null;
}

function markApplied(state: ProductLaunchTrackerState, report: Record<string, unknown>) {
  const migrations = isRecord(state.serverMigrations) ? { ...state.serverMigrations } : {};
  migrations[MIGRATION_KEY] = {
    appliedAt: new Date().toISOString(),
    report,
  };
  return {
    ...state,
    serverMigrations: migrations,
    savedAt: new Date().toISOString(),
    schemaVersion: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)),
  };
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
