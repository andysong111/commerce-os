import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import { isShoplingPriceAdjustmentOperatorEmail } from "@/lib/shoplingPriceAdjustmentAuth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOpsCurrentUser } from "@/lib/supabase/currentUser";

export type ReliabilityIncidentRow = {
  id: string;
  source_system: string;
  engine: string;
  signature: string;
  title: string;
  status: string;
  severity: string;
  risk_level: string;
  error_code: string | null;
  latest_message: string | null;
  occurrence_count: number;
  automatic_recovery_attempts: number;
  automatic_recovery_successes: number;
  learning_state: string;
  regression_state: string;
  last_seen_at: string;
};

export type ReliabilityLearningCaseRow = {
  id: string;
  incident_id: string;
  state: string;
  title: string;
  symptom: string;
  root_cause: string;
  resolution: string;
  prevention_rule: string;
  confidence: number;
  updated_at: string;
};

export type ReliabilityRegressionCaseRow = {
  id: string;
  incident_id: string;
  source_repo: string;
  test_path: string;
  test_name: string;
  protected_invariant: string;
  status: string;
  workflow_name: string | null;
  commit_sha: string | null;
  updated_at: string;
};

export type ReliabilityRecoveryQueueRow = {
  id: string;
  incident_id: string | null;
  source_system: string;
  engine: string;
  run_id: string | null;
  action: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  not_before: string;
  last_error: string | null;
  created_at: string;
};

export type ReliabilityAnalysisQueueRow = {
  id: string;
  learning_case_id: string;
  incident_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  model: string | null;
  last_error: string | null;
  not_before: string;
  created_at: string;
  updated_at: string;
};

export type ReliabilityEventRow = {
  id: string;
  source_system: string;
  engine: string;
  event_type: string;
  status: string;
  severity: string;
  risk_level: string;
  run_id: string | null;
  stage: string | null;
  error_code: string | null;
  automatic_recovery: boolean;
  recovery_action: string | null;
  occurred_at: string;
};

export type ReliabilityImprovementRow = {
  id: string;
  learning_case_id: string;
  incident_id: string;
  source_system: string;
  engine: string;
  error_code: string | null;
  title: string;
  fact_summary: string;
  root_cause: string;
  change_summary: string;
  prevention_rule: string;
  expected_effect: string;
  improvement_kind: string;
  status: string;
  application_mode: string;
  safe_action: string;
  policy_action: string | null;
  risk_level: string;
  confidence: number;
  requires_approval: boolean;
  target_repo: string | null;
  target_test_name: string | null;
  applied_at: string | null;
  applied_reference: string | null;
  baseline_events: number;
  baseline_failures: number;
  baseline_recoveries: number;
  current_events: number;
  current_failures: number;
  current_recoveries: number;
  baseline_failure_rate: number | null;
  current_failure_rate: number | null;
  current_recovery_rate: number | null;
  improvement_percent: number | null;
  measurement_result: string;
  last_measured_at: string | null;
  updated_at: string;
};

export type ReliabilityImprovementActivityRow = {
  id: string;
  improvement_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  summary: string;
  occurred_at: string;
};

export type ReliabilityDashboardData = {
  configured: boolean;
  error: string | null;
  summary: {
    totalEvents: number;
    openIncidents: number;
    criticalOrHighIncidents: number;
    learningCandidates: number;
    analyzedLearningCases: number;
    regressionProposals: number;
    analysisBacklog: number;
    analysisFailures: number;
    queuedRecoveries: number;
    approvalRequired: number;
    aiSaurusEvents: number;
    improvementsTotal: number;
    improvementsApplied: number;
    policyActive: number;
    implementationNeeded: number;
    improvementApprovalRequired: number;
    improvementsMeasuring: number;
    improvementsVerified: number;
    improvementsRegressed: number;
  };
  incidents: ReliabilityIncidentRow[];
  learningCases: ReliabilityLearningCaseRow[];
  regressionCases: ReliabilityRegressionCaseRow[];
  analysisQueue: ReliabilityAnalysisQueueRow[];
  recoveryQueue: ReliabilityRecoveryQueueRow[];
  recentEvents: ReliabilityEventRow[];
  improvements: ReliabilityImprovementRow[];
  improvementActivity: ReliabilityImprovementActivityRow[];
};

const loadSnapshot = unstable_cache(
  async (): Promise<ReliabilityDashboardData> => {
    const admin = await createSupabaseAdminClient();
    if (!admin) return empty(false, "Supabase 운영 연결이 설정되지 않았습니다.");

    const [
      incidentsResult,
      learningResult,
      regressionResult,
      analysisResult,
      recoveryResult,
      eventsResult,
      improvementsResult,
      improvementActivityResult,
      totalEventsResult,
      openIncidentsResult,
      highIncidentsResult,
      criticalIncidentsResult,
      learningCountResult,
      analyzedLearningResult,
      regressionCountResult,
      analysisBacklogResult,
      analysisFailureResult,
      queuedRecoveryResult,
      approvalRecoveryResult,
      aiSaurusEventsResult,
      improvementsTotalResult,
      improvementsAppliedResult,
      policyActiveResult,
      implementationNeededResult,
      improvementApprovalResult,
      improvementsMeasuringResult,
      improvementsVerifiedResult,
      improvementsRegressedResult,
    ] = await Promise.all([
      admin
        .from("reliability_incidents")
        .select(
          "id,source_system,engine,signature,title,status,severity,risk_level,error_code,latest_message,occurrence_count,automatic_recovery_attempts,automatic_recovery_successes,learning_state,regression_state,last_seen_at",
        )
        .order("last_seen_at", { ascending: false })
        .limit(80),
      admin
        .from("reliability_learning_cases")
        .select(
          "id,incident_id,state,title,symptom,root_cause,resolution,prevention_rule,confidence,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(50),
      admin
        .from("reliability_regression_cases")
        .select(
          "id,incident_id,source_repo,test_path,test_name,protected_invariant,status,workflow_name,commit_sha,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(50),
      admin
        .from("reliability_learning_analysis_queue")
        .select(
          "id,learning_case_id,incident_id,status,attempts,max_attempts,model,last_error,not_before,created_at,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(50),
      admin
        .from("reliability_recovery_queue")
        .select(
          "id,incident_id,source_system,engine,run_id,action,status,attempt_count,max_attempts,not_before,last_error,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(60),
      admin
        .from("reliability_events")
        .select(
          "id,source_system,engine,event_type,status,severity,risk_level,run_id,stage,error_code,automatic_recovery,recovery_action,occurred_at",
        )
        .order("occurred_at", { ascending: false })
        .limit(100),
      admin
        .from("reliability_improvements")
        .select(
          "id,learning_case_id,incident_id,source_system,engine,error_code,title,fact_summary,root_cause,change_summary,prevention_rule,expected_effect,improvement_kind,status,application_mode,safe_action,policy_action,risk_level,confidence,requires_approval,target_repo,target_test_name,applied_at,applied_reference,baseline_events,baseline_failures,baseline_recoveries,current_events,current_failures,current_recoveries,baseline_failure_rate,current_failure_rate,current_recovery_rate,improvement_percent,measurement_result,last_measured_at,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(60),
      admin
        .from("reliability_improvement_activity")
        .select(
          "id,improvement_id,event_type,from_status,to_status,summary,occurred_at",
        )
        .order("occurred_at", { ascending: false })
        .limit(80),
      admin.from("reliability_events").select("id", { count: "exact", head: true }),
      admin
        .from("reliability_incidents")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      admin
        .from("reliability_incidents")
        .select("id", { count: "exact", head: true })
        .eq("risk_level", "high"),
      admin
        .from("reliability_incidents")
        .select("id", { count: "exact", head: true })
        .eq("risk_level", "critical"),
      admin
        .from("reliability_learning_cases")
        .select("id", { count: "exact", head: true })
        .eq("state", "candidate"),
      admin
        .from("reliability_learning_analysis_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "succeeded"),
      admin
        .from("reliability_regression_cases")
        .select("id", { count: "exact", head: true })
        .eq("status", "proposed"),
      admin
        .from("reliability_learning_analysis_queue")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "running", "failed"]),
      admin
        .from("reliability_learning_analysis_queue")
        .select("id", { count: "exact", head: true })
        .in("status", ["failed", "dead_letter"]),
      admin
        .from("reliability_recovery_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued"),
      admin
        .from("reliability_recovery_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "approval_required"),
      admin
        .from("reliability_events")
        .select("id", { count: "exact", head: true })
        .eq("source_system", "ai-saurus"),
      admin
        .from("reliability_improvements")
        .select("id", { count: "exact", head: true }),
      admin
        .from("reliability_improvements")
        .select("id", { count: "exact", head: true })
        .not("applied_at", "is", null),
      admin
        .from("reliability_improvements")
        .select("id", { count: "exact", head: true })
        .eq("application_mode", "existing_policy"),
      admin
        .from("reliability_improvements")
        .select("id", { count: "exact", head: true })
        .eq("status", "implementation_needed"),
      admin
        .from("reliability_improvements")
        .select("id", { count: "exact", head: true })
        .eq("status", "approval_required"),
      admin
        .from("reliability_improvements")
        .select("id", { count: "exact", head: true })
        .eq("measurement_result", "insufficient_data"),
      admin
        .from("reliability_improvements")
        .select("id", { count: "exact", head: true })
        .eq("measurement_result", "improved"),
      admin
        .from("reliability_improvements")
        .select("id", { count: "exact", head: true })
        .eq("measurement_result", "regressed"),
    ]);

    const results = [
      incidentsResult,
      learningResult,
      regressionResult,
      analysisResult,
      recoveryResult,
      eventsResult,
      improvementsResult,
      improvementActivityResult,
      totalEventsResult,
      openIncidentsResult,
      highIncidentsResult,
      criticalIncidentsResult,
      learningCountResult,
      analyzedLearningResult,
      regressionCountResult,
      analysisBacklogResult,
      analysisFailureResult,
      queuedRecoveryResult,
      approvalRecoveryResult,
      aiSaurusEventsResult,
      improvementsTotalResult,
      improvementsAppliedResult,
      policyActiveResult,
      implementationNeededResult,
      improvementApprovalResult,
      improvementsMeasuringResult,
      improvementsVerifiedResult,
      improvementsRegressedResult,
    ];
    const errors = results
      .map((result) => result.error?.message)
      .filter((message): message is string => Boolean(message));
    if (errors.length) return empty(true, errors.join(" · "));

    return {
      configured: true,
      error: null,
      summary: {
        totalEvents: totalEventsResult.count ?? 0,
        openIncidents: openIncidentsResult.count ?? 0,
        criticalOrHighIncidents:
          (highIncidentsResult.count ?? 0) + (criticalIncidentsResult.count ?? 0),
        learningCandidates: learningCountResult.count ?? 0,
        analyzedLearningCases: analyzedLearningResult.count ?? 0,
        regressionProposals: regressionCountResult.count ?? 0,
        analysisBacklog: analysisBacklogResult.count ?? 0,
        analysisFailures: analysisFailureResult.count ?? 0,
        queuedRecoveries: queuedRecoveryResult.count ?? 0,
        approvalRequired: approvalRecoveryResult.count ?? 0,
        aiSaurusEvents: aiSaurusEventsResult.count ?? 0,
        improvementsTotal: improvementsTotalResult.count ?? 0,
        improvementsApplied: improvementsAppliedResult.count ?? 0,
        policyActive: policyActiveResult.count ?? 0,
        implementationNeeded: implementationNeededResult.count ?? 0,
        improvementApprovalRequired: improvementApprovalResult.count ?? 0,
        improvementsMeasuring: improvementsMeasuringResult.count ?? 0,
        improvementsVerified: improvementsVerifiedResult.count ?? 0,
        improvementsRegressed: improvementsRegressedResult.count ?? 0,
      },
      incidents: rows<ReliabilityIncidentRow>(incidentsResult.data),
      learningCases: rows<ReliabilityLearningCaseRow>(learningResult.data),
      regressionCases: rows<ReliabilityRegressionCaseRow>(regressionResult.data),
      analysisQueue: rows<ReliabilityAnalysisQueueRow>(analysisResult.data),
      recoveryQueue: rows<ReliabilityRecoveryQueueRow>(recoveryResult.data),
      recentEvents: rows<ReliabilityEventRow>(eventsResult.data),
      improvements: rows<ReliabilityImprovementRow>(improvementsResult.data),
      improvementActivity: rows<ReliabilityImprovementActivityRow>(
        improvementActivityResult.data,
      ),
    };
  },
  ["reliability-learning-dashboard-v3"],
  { revalidate: 15 },
);

export async function loadReliabilityDashboard() {
  const current = await getOpsCurrentUser();
  if (!current.user) {
    redirect("/login?error=login_required&next=%2Freliability");
  }
  if (!isShoplingPriceAdjustmentOperatorEmail(current.user.email)) {
    redirect("/");
  }
  return loadSnapshot();
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function empty(configured: boolean, error: string): ReliabilityDashboardData {
  return {
    configured,
    error,
    summary: {
      totalEvents: 0,
      openIncidents: 0,
      criticalOrHighIncidents: 0,
      learningCandidates: 0,
      analyzedLearningCases: 0,
      regressionProposals: 0,
      analysisBacklog: 0,
      analysisFailures: 0,
      queuedRecoveries: 0,
      approvalRequired: 0,
      aiSaurusEvents: 0,
      improvementsTotal: 0,
      improvementsApplied: 0,
      policyActive: 0,
      implementationNeeded: 0,
      improvementApprovalRequired: 0,
      improvementsMeasuring: 0,
      improvementsVerified: 0,
      improvementsRegressed: 0,
    },
    incidents: [],
    learningCases: [],
    regressionCases: [],
    analysisQueue: [],
    recoveryQueue: [],
    recentEvents: [],
    improvements: [],
    improvementActivity: [],
  };
}
