import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  VERIFIED_PRODUCT_DECISION_BACKUP,
  sha256Hex,
  stableStringify,
  validateProductDecisionBackupMetadata,
  type PortableD1Completed,
  type PortableD1Manifest,
  type ProductDecisionSnapshot,
} from "@/lib/productDecisionSnapshot";
import type { ProductDecisionShadowReport } from "@/lib/productDecisionEngine/shadowComparison";
import { validateVerifiedProductDecisionShadow } from "@/lib/productDecisionEngine/verifiedShadow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SNAPSHOT_OPERATION_TYPE = "PRODUCT_DECISION_SNAPSHOT_IMPORT";
const SHADOW_OPERATION_TYPE = "PRODUCT_DECISION_SHADOW_REPLAY";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      zipSha256?: string;
      dashboardSha256?: string;
      manifest?: PortableD1Manifest;
      completed?: PortableD1Completed;
      snapshot?: ProductDecisionSnapshot;
      shadowReport?: ProductDecisionShadowReport;
    };
    const zipSha256 = String(body.zipSha256 ?? "").trim().toLowerCase();
    const dashboardSha256 = String(body.dashboardSha256 ?? "")
      .trim()
      .toLowerCase();
    const manifest = body.manifest ?? {};
    const completed = body.completed ?? {};
    const snapshot = normalizeSnapshot(body.snapshot);
    const shadowReport = normalizeShadowReport(body.shadowReport);

    validateProductDecisionBackupMetadata(manifest, completed, zipSha256);
    validateVerifiedProductDecisionShadow(shadowReport);
    const calculatedDashboardSha256 = await sha256Hex(stableStringify(snapshot));
    if (
      dashboardSha256 !== VERIFIED_PRODUCT_DECISION_BACKUP.dashboardSha256 ||
      calculatedDashboardSha256 !== VERIFIED_PRODUCT_DECISION_BACKUP.dashboardSha256
    ) {
      return json(
        {
          ok: false,
          code: "SNAPSHOT_HASH_MISMATCH",
          message: "발주 추천 계산 결과가 검증된 백업 결과와 일치하지 않습니다.",
        },
        409,
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(
      /\/$/,
      "",
    );
    const supabaseSecretKey = (
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )?.trim();
    if (!supabaseUrl || !supabaseSecretKey) {
      return json(
        {
          ok: false,
          code: "SUPABASE_ADMIN_NOT_CONFIGURED",
          message: "Ops Center 서버 저장 연결이 설정되지 않았습니다.",
        },
        503,
      );
    }

    const now = new Date().toISOString();
    const snapshotSourceEventId = `product-decision-d1:${zipSha256}`;
    const shadowSourceEventId = `product-decision-shadow:${zipSha256}`;
    const correlationId = `product-decision:${zipSha256.slice(0, 16)}`;
    const response = await fetch(
      `${supabaseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=id,operation_type,source_event_id,started_at`,
      {
        method: "POST",
        headers: {
          ...createSupabaseAdminHeaders(supabaseSecretKey),
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify([
          {
            operation_type: SNAPSHOT_OPERATION_TYPE,
            status: "SUCCEEDED",
            source: "chatgpt-site-d1-backup",
            source_event_id: snapshotSourceEventId,
            correlation_id: correlationId,
            actor_type: "OPS_MIGRATION",
            input_snapshot: {
              zipSha256,
              dashboardSha256,
              source: completed.source,
              exportedAt: manifest.exportedAt,
              completedAt: completed.completedAt,
              counts: completed.counts,
              totalRows: VERIFIED_PRODUCT_DECISION_BACKUP.totalRows,
            },
            result_snapshot: snapshot,
            error_message: null,
            started_at: now,
            finished_at: now,
            updated_at: now,
          },
          {
            operation_type: SHADOW_OPERATION_TYPE,
            status: "SUCCEEDED",
            source: "ops-center-product-decision-engine",
            source_event_id: shadowSourceEventId,
            correlation_id: correlationId,
            actor_type: "OPS_SHADOW_ENGINE",
            input_snapshot: {
              zipSha256,
              sourceRunId: shadowReport.runId,
              analysisAsOf: shadowReport.analysisAsOf,
              sourceExportedAt: manifest.exportedAt,
              sourceCompletedAt: completed.completedAt,
              note:
                "백업 완료시각이 계산시각보다 늦어 그 사이 원장 변경은 SOURCE_INPUT_DRIFT 또는 PORTFOLIO_BUDGET_DRIFT로 분리합니다.",
            },
            result_snapshot: shadowReport,
            error_message: null,
            started_at: now,
            finished_at: now,
            updated_at: now,
          },
        ]),
        cache: "no-store",
      },
    );
    const responseText = await response.text();
    const responseBody = responseText ? safeJson(responseText) : null;
    if (!response.ok) {
      return json(
        {
          ok: false,
          code: "SNAPSHOT_STORE_FAILED",
          message: supabaseMessage(responseBody, response.status),
        },
        500,
      );
    }

    const storedRows = Array.isArray(responseBody) ? responseBody : [];
    return json({
      ok: true,
      sourceEventId: snapshotSourceEventId,
      shadowSourceEventId,
      storedOperationCount: storedRows.length,
      productCount: snapshot.products?.length ?? 0,
      shadowExactCount: shadowReport.exactFinalCount,
      shadowMismatchCount: shadowReport.finalMismatchCount,
      shadowUnexplainedCount: shadowReport.unexplainedMismatchCount,
      importedAt: now,
      message:
        "검증된 D1 스냅샷과 Ops Center 자체 엔진 그림자 재계산 보고서를 운영 원장에 보존했습니다.",
    });
  } catch (error) {
    return json(
      {
        ok: false,
        code: "INVALID_PRODUCT_DECISION_BACKUP",
        message:
          error instanceof Error
            ? error.message
            : "발주 추천 백업을 검증하지 못했습니다.",
      },
      400,
    );
  }
}

function normalizeSnapshot(value: unknown): ProductDecisionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("발주 추천 스냅샷 형식이 올바르지 않습니다.");
  }
  const snapshot = value as ProductDecisionSnapshot;
  if (
    snapshot.mode !== "LIVE" ||
    !snapshot.runId ||
    !Array.isArray(snapshot.products) ||
    snapshot.products.length !== VERIFIED_PRODUCT_DECISION_BACKUP.productCount
  ) {
    throw new Error("발주 추천 스냅샷의 실행정보 또는 상품 수가 올바르지 않습니다.");
  }
  return snapshot;
}

function normalizeShadowReport(value: unknown): ProductDecisionShadowReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("발주 추천 그림자 재계산 보고서 형식이 올바르지 않습니다.");
  }
  const report = value as ProductDecisionShadowReport;
  if (!report.runId || !report.analysisAsOf || !Array.isArray(report.products)) {
    throw new Error("그림자 재계산 실행정보 또는 상품 상세가 없습니다.");
  }
  return report;
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function supabaseMessage(value: unknown, status: number) {
  const row = record(value);
  return typeof row.message === "string"
    ? row.message
    : `Ops Center 저장 요청에 실패했습니다. status=${status}`;
}
