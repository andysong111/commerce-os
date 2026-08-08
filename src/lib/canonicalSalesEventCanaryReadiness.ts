import { createHash } from "node:crypto";
import { loadCanonicalEventMismatchEvidenceStatus } from "@/lib/canonicalSalesEventMismatchEvidence";
import { loadCanonicalSalesEventFullAuditStatus } from "@/lib/canonicalSalesEventFullAudit";
import { loadCanonicalSalesEventIncrementalShadowStatus } from "@/lib/canonicalSalesEventIncrementalShadow";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadPostApplyCanonicalReconciliation } from "@/lib/stage8PostApplyCanonicalReconciliation";

const MAX_EXACT_AUDIT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;

export type CanonicalSalesEventCanaryReadinessCheck = {
  key: string;
  passed: boolean;
  message: string;
};

export type CanonicalSalesEventCanaryReadiness = {
  generatedAt: string;
  state: "WAITING" | "NO_CHANGES" | "READY_ONE_EVENT" | "BLOCKED";
  readyForOneEventCanary: boolean;
  automaticWriteEnabled: false;
  maxWriteRows: 1;
  selectedExternalId: string | null;
  selectedChangeKind: string | null;
  selectedBarcode: string | null;
  selectedExpectedSkuId: string | null;
  selectedCandidate: {
    occurredAt: string;
    quantity: number;
    revenue: number;
    validSale: boolean;
  } | null;
  selectedPersisted: {
    skuId: string;
    occurredAt: string;
    quantity: number;
    revenue: number;
    validSale: boolean;
  } | null;
  canaryToken: string | null;
  currentMappingFingerprint: string;
  incrementalCandidateFingerprint: string | null;
  evidenceCandidateFingerprint: string | null;
  fullAuditFingerprint: string | null;
  baselineReconciliationFingerprint: string | null;
  checks: CanonicalSalesEventCanaryReadinessCheck[];
  message: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function planningMappingFingerprint(
  products: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>["products"],
) {
  const normalized = products
    .map((product) => ({
      skuId: text(product.skuId),
      barcode: text(product.barcode).toUpperCase().replace(/\s+/g, ""),
      skuActive: product.skuActive !== false,
      listings: (product.listings ?? [])
        .map((listing) => ({
          goodsKey: text(listing.goodsKey),
          optionId: text(listing.optionId),
          unitsPerOrder: Math.max(1, Math.round(numeric(listing.unitsPerOrder)) || 1),
          active: listing.active !== false,
        }))
        .sort((left, right) =>
          `${left.goodsKey}\u0000${left.optionId}\u0000${left.unitsPerOrder}\u0000${left.active}`.localeCompare(
            `${right.goodsKey}\u0000${right.optionId}\u0000${right.unitsPerOrder}\u0000${right.active}`,
          ),
        ),
    }))
    .filter((row) => MANAGED_BARCODE.test(row.barcode))
    .sort((left, right) =>
      `${left.barcode}\u0000${left.skuId}`.localeCompare(`${right.barcode}\u0000${right.skuId}`),
    );
  return `sha256:${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
}

function check(
  checks: CanonicalSalesEventCanaryReadinessCheck[],
  key: string,
  passed: boolean,
  message: string,
) {
  checks.push({ key, passed, message });
  return passed;
}

function makeCanaryToken(input: Record<string, unknown>) {
  return `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}

export async function loadCanonicalSalesEventCanaryReadiness(): Promise<CanonicalSalesEventCanaryReadiness> {
  const generatedAt = new Date().toISOString();
  const checks: CanonicalSalesEventCanaryReadinessCheck[] = [];
  const [incremental, evidence, fullAudit, reconciliation, planning] = await Promise.all([
    loadCanonicalSalesEventIncrementalShadowStatus(),
    loadCanonicalEventMismatchEvidenceStatus(),
    loadCanonicalSalesEventFullAuditStatus(),
    loadPostApplyCanonicalReconciliation(),
    loadProductPlanningSnapshot(),
  ]);
  const currentMappingFingerprint = planningMappingFingerprint(planning.products);
  const incrementalReport = incremental.report;
  const evidenceReport = evidence.report;
  const auditReport = fullAudit.report;

  const base = {
    generatedAt,
    automaticWriteEnabled: false as const,
    maxWriteRows: 1 as const,
    selectedExternalId: null,
    selectedChangeKind: null,
    selectedBarcode: null,
    selectedExpectedSkuId: null,
    selectedCandidate: null,
    selectedPersisted: null,
    canaryToken: null,
    currentMappingFingerprint,
    incrementalCandidateFingerprint: incrementalReport?.candidateFingerprint ?? null,
    evidenceCandidateFingerprint: evidenceReport?.candidateFingerprint ?? null,
    fullAuditFingerprint: auditReport?.auditFingerprint ?? null,
    baselineReconciliationFingerprint: reconciliation.reconciliationFingerprint,
    checks,
  };

  if (incremental.state !== "SHADOW_READY" || !incrementalReport) {
    check(checks, "incremental-ready", false, `Incremental shadow 상태 ${incremental.state}`);
    return {
      ...base,
      state: "WAITING",
      readyForOneEventCanary: false,
      message: "Exact-event incremental shadow 완료를 기다립니다.",
    };
  }
  check(checks, "incremental-ready", true, `Incremental candidate ${incrementalReport.candidateFingerprint}`);

  if (evidence.state === "NO_CHANGES" && evidenceReport?.shadowPendingMismatchCount === 0) {
    check(checks, "mismatch-evidence", true, "현재 신규·변경 event가 0건입니다.");
    return {
      ...base,
      state: "NO_CHANGES",
      readyForOneEventCanary: false,
      message: "현재 persisted와 다른 canonical event가 없어 canary write가 필요하지 않습니다.",
    };
  }
  if (evidence.state !== "READY" || !evidenceReport) {
    check(checks, "mismatch-evidence", false, `Mismatch evidence 상태 ${evidence.state}`);
    return {
      ...base,
      state: "WAITING",
      readyForOneEventCanary: false,
      message: "Persisted before/after mismatch 분류 완료를 기다립니다.",
    };
  }

  check(
    checks,
    "candidate-fingerprint-match",
    evidenceReport.candidateFingerprint === incrementalReport.candidateFingerprint,
    `incremental ${incrementalReport.candidateFingerprint} · evidence ${evidenceReport.candidateFingerprint}`,
  );
  check(
    checks,
    "evidence-all-canary-safe",
    evidenceReport.canaryEligible &&
      evidenceReport.unsafeForCanaryCount === 0 &&
      evidenceReport.canaryEligibleCount === evidenceReport.inspectedMismatchCount &&
      evidenceReport.inspectedMismatchCount > 0,
    `검토 ${evidenceReport.inspectedMismatchCount} · 가능 ${evidenceReport.canaryEligibleCount} · 차단 ${evidenceReport.unsafeForCanaryCount}`,
  );
  check(
    checks,
    "baseline-reconciliation-ready",
    reconciliation.ready &&
      Boolean(reconciliation.reconciliationFingerprint) &&
      reconciliation.reconciliationFingerprint === incrementalReport.baselineReconciliationFingerprint,
    `현재 baseline ${reconciliation.reconciliationFingerprint ?? "-"} · incremental ${incrementalReport.baselineReconciliationFingerprint}`,
  );
  check(
    checks,
    "current-mapping-stable",
    currentMappingFingerprint === incrementalReport.planningMappingFingerprint,
    `현재 ${currentMappingFingerprint} · incremental ${incrementalReport.planningMappingFingerprint}`,
  );

  const auditAgeMs = auditReport
    ? Date.now() - Date.parse(auditReport.generatedAt)
    : Number.POSITIVE_INFINITY;
  check(
    checks,
    "recent-full-audit-exact",
    fullAudit.state === "EXACT" &&
      Boolean(auditReport?.exact) &&
      Number.isFinite(auditAgeMs) &&
      auditAgeMs >= 0 &&
      auditAgeMs <= MAX_EXACT_AUDIT_AGE_MS,
    auditReport
      ? `Full audit ${fullAudit.state} · ${Math.max(0, Math.round(auditAgeMs / 3_600_000))}시간 경과`
      : `Full audit 상태 ${fullAudit.state}`,
  );
  check(
    checks,
    "full-audit-mapping-match",
    Boolean(auditReport) && auditReport!.planningMappingFingerprint === currentMappingFingerprint,
    `audit ${auditReport?.planningMappingFingerprint ?? "-"} · current ${currentMappingFingerprint}`,
  );
  check(
    checks,
    "full-audit-baseline-match",
    Boolean(auditReport) &&
      auditReport!.baselineReconciliationFingerprint === reconciliation.reconciliationFingerprint,
    `audit ${auditReport?.baselineReconciliationFingerprint ?? "-"} · baseline ${reconciliation.reconciliationFingerprint ?? "-"}`,
  );

  const selected = [...evidenceReport.detailSamples]
    .filter(
      (row) =>
        row.expectedSkuId !== null &&
        !row.differences.some((difference) =>
          ["ID", "SOURCE", "EXTERNAL_ID", "OCCURRED_AT", "SKU_IDENTITY"].includes(difference),
        ),
    )
    .sort((left, right) => left.externalId.localeCompare(right.externalId))[0] ?? null;
  check(
    checks,
    "deterministic-one-event",
    Boolean(selected),
    selected
      ? `선택 externalId ${selected.externalId} · ${selected.changeKind}`
      : "안전한 1건 canary 후보를 detail sample에서 선택하지 못했습니다.",
  );

  const ready = checks.every((row) => row.passed);
  if (!ready || !selected || !selected.expectedSkuId) {
    return {
      ...base,
      state: "BLOCKED",
      readyForOneEventCanary: false,
      message: "1건 canonical event canary를 허용하기 위한 fail-closed 조건이 모두 충족되지 않았습니다.",
    };
  }

  const canaryToken = makeCanaryToken({
    maxWriteRows: 1,
    incrementalRequestId: incremental.requestId,
    incrementalAnalysisAsOf: incremental.analysisAsOf,
    incrementalCandidateFingerprint: incrementalReport.candidateFingerprint,
    evidenceCandidateFingerprint: evidenceReport.candidateFingerprint,
    evidenceInspectedMismatchCount: evidenceReport.inspectedMismatchCount,
    fullAuditFingerprint: auditReport?.auditFingerprint,
    fullAuditGeneratedAt: auditReport?.generatedAt,
    baselineReconciliationFingerprint: reconciliation.reconciliationFingerprint,
    currentMappingFingerprint,
    selected: {
      externalId: selected.externalId,
      changeKind: selected.changeKind,
      differences: selected.differences,
      expectedSkuId: selected.expectedSkuId,
      barcode: selected.candidate.barcode,
      candidate: selected.candidate,
      persisted: selected.persisted,
    },
  });

  return {
    ...base,
    state: "READY_ONE_EVENT",
    readyForOneEventCanary: true,
    selectedExternalId: selected.externalId,
    selectedChangeKind: selected.changeKind,
    selectedBarcode: selected.candidate.barcode,
    selectedExpectedSkuId: selected.expectedSkuId,
    selectedCandidate: {
      occurredAt: selected.candidate.occurredAt,
      quantity: selected.candidate.quantity,
      revenue: selected.candidate.revenue,
      validSale: selected.candidate.validSale,
    },
    selectedPersisted: selected.persisted,
    canaryToken,
    message:
      "최근 exact 360일 감사·현재 identity mapping·incremental/evidence/baseline fingerprint가 모두 고정됐습니다. 단, 자동쓰기는 계속 꺼져 있고 향후 일회성 1건 실행기는 이 canary token을 다시 검증해야 합니다.",
  };
}
