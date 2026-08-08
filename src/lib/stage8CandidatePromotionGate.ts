import { createHash } from "node:crypto";
import {
  loadCandidateDemandParityStatus,
  loadLatestCandidateSalesSnapshot,
  type CandidateDemandParityReport,
} from "@/lib/stage8CandidateDemandParity";
import {
  CANDIDATE_MISMATCH_EVIDENCE_REQUEST,
  loadCandidateMismatchEvidenceStatus,
  type CandidateMismatchEvidenceRequest,
} from "@/lib/stage8CandidateMismatchEvidence";
import { loadProductMasterShoplingSalesEventSyncStatus } from "@/lib/productMasterShoplingSalesEventSync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type CandidatePromotionGateState =
  | "BLOCKED"
  | "EXACT_MATCH"
  | "SAFE_CANONICAL_SUPERSET";

export type CandidatePromotionGateCheck = {
  key: string;
  passed: boolean;
  message: string;
};

export type CandidatePromotionGate = {
  generatedAt: string;
  state: CandidatePromotionGateState;
  safeToApply: boolean;
  candidateSalesRequestId: string | null;
  candidatePlanFingerprint: string | null;
  candidateEventFingerprint: string | null;
  candidateParityFingerprint: string | null;
  evidenceFingerprint: string | null;
  promotionFingerprint: string | null;
  checks: CandidatePromotionGateCheck[];
  message: string;
};

type OperationRow = {
  input_snapshot?: unknown;
  started_at?: unknown;
};

const ALLOWED_SUPERSET_REASONS = new Set([
  "CANONICAL_HISTORICAL_BARCODE_LEGACY_ACTIVE_ONLY",
  "LEGACY_ACTIVE_IDENTITY_MISSING",
]);

const ALLOWED_SUPERSET_CATEGORIES = new Set([
  "CANONICAL_ONLY_LEGACY_IGNORES",
  "CANONICAL_ONLY_LEGACY_UNMAPPED",
]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function fingerprint(value: unknown) {
  const normalized = text(value);
  return /^sha256:[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function sortedUnique(values: string[]) {
  return [...new Set(values.map(text).filter(Boolean))].sort();
}

function sameStrings(left: string[], right: string[]) {
  const a = sortedUnique(left);
  const b = sortedUnique(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function totalRecord(values: Record<string, number> | undefined) {
  return Object.values(values ?? {}).reduce(
    (total, value) => total + integer(value),
    0,
  );
}

function countOutsideAllowed(
  values: Record<string, number> | undefined,
  allowed: Set<string>,
) {
  return Object.entries(values ?? {}).reduce(
    (total, [key, value]) =>
      allowed.has(key) ? total : total + Math.max(0, integer(value)),
    0,
  );
}

function candidateNeverBelowDirect(report: CandidateDemandParityReport) {
  if (
    report.unitMismatchCount !== report.revenueMismatchCount ||
    report.unitMismatchCount !== report.mismatchSamples.length
  ) {
    return false;
  }
  return report.mismatchSamples.every((row) => {
    if (
      row.candidateUnits.length !== row.directUnits.length ||
      row.candidateRevenue.length !== row.directRevenue.length
    ) return false;
    return (
      row.candidateUnits.every(
        (value, index) => integer(value) >= integer(row.directUnits[index]),
      ) &&
      row.candidateRevenue.every(
        (value, index) => integer(value) >= integer(row.directRevenue[index]),
      )
    );
  });
}

function expectedMismatchTargets(report: CandidateDemandParityReport) {
  return sortedUnique([
    ...report.mismatchSamples.map((row) => row.barcode),
    ...report.missingDirectBarcodes,
    ...report.directOnlyManagedBarcodes,
  ]);
}

function parseEvidenceRequest(value: unknown): CandidateMismatchEvidenceRequest | null {
  const raw = object(value);
  const requestId = text(raw.requestId);
  const candidateSalesRequestId = text(raw.candidateSalesRequestId);
  const candidateParityRequestId = text(raw.candidateParityRequestId);
  const analysisAsOf = iso(raw.analysisAsOf);
  const planningContentFingerprint = fingerprint(raw.planningContentFingerprint);
  const candidateEventFingerprint = fingerprint(raw.candidateEventFingerprint);
  const candidatePlanFingerprint = fingerprint(raw.candidatePlanFingerprint);
  const candidateParityFingerprint = fingerprint(raw.candidateParityFingerprint);
  const targetBarcodes = Array.isArray(raw.targetBarcodes)
    ? raw.targetBarcodes.map(text).filter(Boolean)
    : [];
  const ranges = Array.isArray(raw.ranges)
    ? raw.ranges
        .map(object)
        .map((range) => ({ start: text(range.start), end: text(range.end) }))
        .filter(
          (range) =>
            /^\d{4}-\d{2}-\d{2}$/.test(range.start) &&
            /^\d{4}-\d{2}-\d{2}$/.test(range.end),
        )
    : [];
  if (
    !requestId ||
    !candidateSalesRequestId ||
    !candidateParityRequestId ||
    !analysisAsOf ||
    !planningContentFingerprint ||
    !candidateEventFingerprint ||
    !candidatePlanFingerprint ||
    !candidateParityFingerprint ||
    !targetBarcodes.length ||
    !ranges.length
  ) return null;
  return {
    requestId,
    candidateSalesRequestId,
    candidateParityRequestId,
    analysisAsOf,
    planningContentFingerprint,
    candidateEventFingerprint,
    candidatePlanFingerprint,
    candidateParityFingerprint,
    targetBarcodes,
    ranges,
    createdAt: iso(raw.createdAt) || analysisAsOf,
  };
}

async function latestEvidenceRequest() {
  const admin = await createSupabaseAdminClient();
  if (!admin) return null;
  const result = await admin
    .from("commerce_operation_runs")
    .select("input_snapshot,started_at")
    .eq("operation_type", CANDIDATE_MISMATCH_EVIDENCE_REQUEST)
    .order("started_at", { ascending: false })
    .limit(20);
  if (result.error) throw new Error(result.error.message);
  for (const row of (result.data ?? []) as OperationRow[]) {
    const request = parseEvidenceRequest(row.input_snapshot);
    if (request) return request;
  }
  return null;
}

function check(
  checks: CandidatePromotionGateCheck[],
  key: string,
  passed: boolean,
  message: string,
) {
  checks.push({ key, passed, message });
  return passed;
}

function makePromotionFingerprint(input: {
  state: CandidatePromotionGateState;
  candidateSalesRequestId: string;
  candidatePlanFingerprint: string;
  candidateEventFingerprint: string;
  candidateParityFingerprint: string;
  evidenceFingerprint: string | null;
}) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")}`;
}

export async function loadCandidatePromotionGate(): Promise<CandidatePromotionGate> {
  const [salesStatus, candidate, parity, evidenceStatus, evidenceRequest] =
    await Promise.all([
      loadProductMasterShoplingSalesEventSyncStatus(),
      loadLatestCandidateSalesSnapshot().catch(() => null),
      loadCandidateDemandParityStatus(),
      loadCandidateMismatchEvidenceStatus(),
      latestEvidenceRequest(),
    ]);
  const checks: CandidatePromotionGateCheck[] = [];
  const generatedAt = new Date().toISOString();

  const candidateExists = check(
    checks,
    "candidate-exists",
    Boolean(candidate),
    candidate ? `후보 판매 이벤트 ${candidate.salesRequestId}` : "후보 판매 이벤트가 없습니다.",
  );
  if (!candidate || !candidateExists) {
    return {
      generatedAt,
      state: "BLOCKED",
      safeToApply: false,
      candidateSalesRequestId: null,
      candidatePlanFingerprint: null,
      candidateEventFingerprint: null,
      candidateParityFingerprint: null,
      evidenceFingerprint: null,
      promotionFingerprint: null,
      checks,
      message: "쓰기 전 후보 판매 이벤트가 없어 Product Master 적재를 차단합니다.",
    };
  }

  const salesReady = ["READY_CANARY", "READY_FULL"].includes(salesStatus.state);
  check(
    checks,
    "sales-ready",
    salesReady,
    `판매 이벤트 후보 상태 ${salesStatus.state}`,
  );
  check(
    checks,
    "sales-request-match",
    salesStatus.requestId === candidate.salesRequestId,
    `현재 요청 ${salesStatus.requestId ?? "-"} · 후보 요청 ${candidate.salesRequestId}`,
  );
  check(
    checks,
    "sales-report-clean",
    candidate.report.unmappedRows === 0 && candidate.report.identityConflictCount === 0,
    `미연결 ${candidate.report.unmappedRows} · identity 충돌 ${candidate.report.identityConflictCount}`,
  );
  check(
    checks,
    "sales-plan-match",
    salesStatus.report?.planFingerprint === candidate.planFingerprint &&
      salesStatus.report?.eventFingerprint === candidate.eventFingerprint,
    "현재 판매 이벤트 report와 후보 event/plan 지문이 동일해야 합니다.",
  );

  const parityContextMatch = Boolean(
    parity.report &&
      parity.report.candidateSalesRequestId === candidate.salesRequestId &&
      parity.report.analysisAsOf === candidate.analysisAsOf &&
      parity.report.planningContentFingerprint === candidate.planningContentFingerprint &&
      parity.report.candidateEventFingerprint === candidate.eventFingerprint &&
      parity.report.candidatePlanFingerprint === candidate.planFingerprint,
  );
  check(
    checks,
    "parity-context-match",
    parityContextMatch,
    parityContextMatch
      ? `Candidate parity ${parity.requestId ?? "-"}가 동일 후보에 고정됐습니다.`
      : "Candidate parity가 현재 후보와 일치하지 않습니다.",
  );

  const baseReady = checks.every((row) => row.passed);
  if (baseReady && parity.state === "MATCH" && parity.report) {
    const promotionFingerprint = makePromotionFingerprint({
      state: "EXACT_MATCH",
      candidateSalesRequestId: candidate.salesRequestId,
      candidatePlanFingerprint: candidate.planFingerprint,
      candidateEventFingerprint: candidate.eventFingerprint,
      candidateParityFingerprint: parity.report.parityFingerprint,
      evidenceFingerprint: null,
    });
    return {
      generatedAt,
      state: "EXACT_MATCH",
      safeToApply: true,
      candidateSalesRequestId: candidate.salesRequestId,
      candidatePlanFingerprint: candidate.planFingerprint,
      candidateEventFingerprint: candidate.eventFingerprint,
      candidateParityFingerprint: parity.report.parityFingerprint,
      evidenceFingerprint: null,
      promotionFingerprint,
      checks,
      message:
        "모든 활성 관리 SKU의 12×30일 수량·매출이 동일시점 Shopling과 완전히 일치해 canary 적재가 허용됩니다.",
    };
  }

  check(
    checks,
    "parity-is-mismatch",
    parity.state === "MISMATCH" && Boolean(parity.report),
    `Candidate parity 상태 ${parity.state}`,
  );
  const parityReport = parity.report;
  if (!parityReport) {
    return {
      generatedAt,
      state: "BLOCKED",
      safeToApply: false,
      candidateSalesRequestId: candidate.salesRequestId,
      candidatePlanFingerprint: candidate.planFingerprint,
      candidateEventFingerprint: candidate.eventFingerprint,
      candidateParityFingerprint: null,
      evidenceFingerprint: evidenceStatus.report?.evidenceFingerprint ?? null,
      promotionFingerprint: null,
      checks,
      message: "Candidate parity report가 없어 적재를 차단합니다.",
    };
  }

  const mismatchCoverageSafe =
    parityReport.missingDirectCount === 0 &&
    parityReport.directOnlyManagedCount === 0 &&
    parityReport.unitMismatchCount === parityReport.revenueMismatchCount &&
    parityReport.unitMismatchCount === parityReport.mismatchSamples.length &&
    parityReport.mismatchSamples.length > 0;
  check(
    checks,
    "parity-mismatch-fully-sampled",
    mismatchCoverageSafe,
    `수량불일치 ${parityReport.unitMismatchCount} · 매출불일치 ${parityReport.revenueMismatchCount} · 표본 ${parityReport.mismatchSamples.length} · 누락 ${parityReport.missingDirectCount}/${parityReport.directOnlyManagedCount}`,
  );
  check(
    checks,
    "candidate-never-below-direct",
    candidateNeverBelowDirect(parityReport) &&
      parityReport.candidateMinusDirectUnits >= 0 &&
      parityReport.candidateMinusDirectRevenue >= 0,
    `Candidate−직접 수량 ${parityReport.candidateMinusDirectUnits} · 매출 ${parityReport.candidateMinusDirectRevenue}`,
  );

  const evidenceComplete =
    evidenceStatus.state === "COMPLETE" && Boolean(evidenceStatus.report) && Boolean(evidenceRequest);
  check(
    checks,
    "evidence-complete",
    evidenceComplete,
    `Candidate mismatch evidence 상태 ${evidenceStatus.state}`,
  );
  const evidenceContextMatch = Boolean(
    evidenceRequest &&
      evidenceRequest.candidateSalesRequestId === candidate.salesRequestId &&
      evidenceRequest.candidateParityRequestId === parity.requestId &&
      evidenceRequest.analysisAsOf === candidate.analysisAsOf &&
      evidenceRequest.planningContentFingerprint === candidate.planningContentFingerprint &&
      evidenceRequest.candidateEventFingerprint === candidate.eventFingerprint &&
      evidenceRequest.candidatePlanFingerprint === candidate.planFingerprint &&
      evidenceRequest.candidateParityFingerprint === parityReport.parityFingerprint &&
      sameStrings(evidenceRequest.targetBarcodes, expectedMismatchTargets(parityReport)),
  );
  check(
    checks,
    "evidence-context-match",
    evidenceContextMatch,
    evidenceContextMatch
      ? "Evidence가 동일 candidate/parity와 전체 mismatch 대상에 고정됐습니다."
      : "Evidence의 후보·parity·대상 지문이 현재 mismatch와 다릅니다.",
  );

  const evidenceReport = evidenceStatus.report;
  const noTruncation = Boolean(evidenceReport && evidenceReport.truncatedEvidenceRows === 0);
  check(
    checks,
    "evidence-not-truncated",
    noTruncation,
    `Evidence 절단 ${evidenceReport?.truncatedEvidenceRows ?? -1}행`,
  );

  const forbiddenCategoryCount = evidenceReport
    ? countOutsideAllowed(evidenceReport.categoryCounts, ALLOWED_SUPERSET_CATEGORIES)
    : -1;
  const allowedCategoryCount = evidenceReport
    ? Object.entries(evidenceReport.categoryCounts).reduce(
        (total, [key, value]) =>
          ALLOWED_SUPERSET_CATEGORIES.has(key)
            ? total + Math.max(0, integer(value))
            : total,
        0,
      )
    : 0;
  check(
    checks,
    "only-candidate-identity-advantage-categories",
    Boolean(
      evidenceReport &&
        forbiddenCategoryCount === 0 &&
        allowedCategoryCount === evidenceReport.evidenceRows &&
        evidenceReport.evidenceRows > 0,
    ),
    `허용 candidate-only ${allowedCategoryCount}행 · 금지 분류 ${forbiddenCategoryCount}행`,
  );

  const forbiddenReasonCount = evidenceReport
    ? countOutsideAllowed(evidenceReport.reasonCounts, ALLOWED_SUPERSET_REASONS)
    : -1;
  const allowedReasonCount = evidenceReport
    ? Object.entries(evidenceReport.reasonCounts).reduce(
        (total, [key, value]) =>
          ALLOWED_SUPERSET_REASONS.has(key)
            ? total + Math.max(0, integer(value))
            : total,
        0,
      )
    : 0;
  check(
    checks,
    "only-proven-safe-identity-reasons",
    Boolean(
      evidenceReport &&
        forbiddenReasonCount === 0 &&
        allowedReasonCount === evidenceReport.evidenceRows,
    ),
    `허용 identity 이유 ${allowedReasonCount}행 · 금지 이유 ${forbiddenReasonCount}행`,
  );

  const evidenceUnitDelta = evidenceReport
    ? totalRecord(evidenceReport.categoryUnitDelta)
    : 0;
  const evidenceRevenueDelta = evidenceReport
    ? totalRecord(evidenceReport.categoryRevenueDelta)
    : 0;
  check(
    checks,
    "evidence-reconciles-parity-delta",
    Boolean(
      evidenceReport &&
        evidenceUnitDelta === -parityReport.candidateMinusDirectUnits &&
        evidenceRevenueDelta === -parityReport.candidateMinusDirectRevenue,
    ),
    `Evidence 기존−Candidate ${evidenceUnitDelta}개/${evidenceRevenueDelta}원 · parity Candidate−직접 ${parityReport.candidateMinusDirectUnits}개/${parityReport.candidateMinusDirectRevenue}원`,
  );

  const safeToApply = checks.every((row) => row.passed);
  const evidenceFingerprint = evidenceReport?.evidenceFingerprint ?? null;
  const state: CandidatePromotionGateState = safeToApply
    ? "SAFE_CANONICAL_SUPERSET"
    : "BLOCKED";
  const promotionFingerprint = safeToApply
    ? makePromotionFingerprint({
        state,
        candidateSalesRequestId: candidate.salesRequestId,
        candidatePlanFingerprint: candidate.planFingerprint,
        candidateEventFingerprint: candidate.eventFingerprint,
        candidateParityFingerprint: parityReport.parityFingerprint,
        evidenceFingerprint,
      })
    : null;
  return {
    generatedAt,
    state,
    safeToApply,
    candidateSalesRequestId: candidate.salesRequestId,
    candidatePlanFingerprint: candidate.planFingerprint,
    candidateEventFingerprint: candidate.eventFingerprint,
    candidateParityFingerprint: parityReport.parityFingerprint,
    evidenceFingerprint,
    promotionFingerprint,
    checks,
    message: safeToApply
      ? "기존 직접집계가 놓친 판매만 원주문행 identity 근거로 완전히 설명됐고 Candidate가 어느 구간에서도 직접집계보다 작지 않아 canary 적재가 허용됩니다."
      : "쓰기 전 증거 게이트가 완전히 통과하지 않아 Product Master 적재를 차단합니다.",
  };
}
