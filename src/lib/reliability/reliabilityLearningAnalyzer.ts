import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redactReliabilityText } from "@/lib/reliability/reliabilityEvent";
import {
  buildReliabilityLearningPrompt,
  parseReliabilityLearningAnalysis,
  reliabilityLearningAnalysisSchema,
  reliabilityLearningSystemPrompt,
  type ReliabilityLearningAnalysis,
  type ReliabilityLearningAnalysisJob,
} from "@/lib/reliability/reliabilityLearningPolicy";

export type ReliabilityLearningAnalyzerResult = {
  ok: boolean;
  configured: boolean;
  claimed: number;
  succeeded: number;
  failed: number;
  model: string | null;
  message: string;
};

type OpenAiPayload = Parameters<typeof parseReliabilityLearningAnalysis>[0] & {
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
  };
};

const MAX_JOBS_PER_RUN = 1;
const OPENAI_TIMEOUT_MS = 42_000;

function openAiConfiguration() {
  const apiKey = String(
    process.env.RELIABILITY_OPENAI_API_KEY ??
      process.env.OPENAI_API_KEY ??
      process.env.OPS_AI_HELP_OPENAI_API_KEY ??
      "",
  ).trim();
  const model = String(
    process.env.RELIABILITY_OPENAI_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-5-mini",
  )
    .trim()
    .slice(0, 120);
  if (!apiKey || !model) return null;
  return { apiKey, model };
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeClaimedJob(value: unknown): ReliabilityLearningAnalysisJob {
  const row = asObject(value);
  const required = [
    "job_id",
    "learning_case_id",
    "incident_id",
    "source_system",
    "engine",
    "signature",
    "title",
  ] as const;
  for (const field of required) {
    if (!String(row[field] ?? "").trim()) {
      throw new TypeError(`학습 분석 작업의 ${field} 값이 비어 있습니다.`);
    }
  }

  return {
    job_id: String(row.job_id),
    learning_case_id: String(row.learning_case_id),
    incident_id: String(row.incident_id),
    source_system: String(row.source_system),
    engine: String(row.engine),
    signature: String(row.signature),
    title: String(row.title),
    error_code: row.error_code == null ? null : String(row.error_code),
    severity: String(row.severity ?? "warning"),
    risk_level: String(row.risk_level ?? "low"),
    occurrence_count: numberOrZero(row.occurrence_count),
    latest_message:
      row.latest_message == null ? null : String(row.latest_message),
    symptom: String(row.symptom ?? ""),
    current_confidence: numberOrZero(row.current_confidence),
    case_evidence: row.case_evidence,
    recent_events: row.recent_events,
    attempts: Math.trunc(numberOrZero(row.attempts)),
  };
}

async function claimAnalysisJobs() {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    throw new Error("OPS CENTER Supabase 관리자 연결이 설정되지 않았습니다.");
  }
  const result = await admin.rpc("claim_reliability_learning_analysis", {
    p_limit: MAX_JOBS_PER_RUN,
  });
  if (result.error) {
    throw new Error(`학습 분석 작업을 가져오지 못했습니다: ${result.error.message}`);
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  return {
    admin,
    jobs: rows.map(normalizeClaimedJob),
  };
}

async function requestOpenAiAnalysis(
  job: ReliabilityLearningAnalysisJob,
  config: { apiKey: string; model: string },
): Promise<ReliabilityLearningAnalysis> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      instructions: reliabilityLearningSystemPrompt(),
      input: buildReliabilityLearningPrompt(job),
      max_output_tokens: 1_800,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "commerce_os_reliability_learning_analysis",
          strict: true,
          schema: reliabilityLearningAnalysisSchema(),
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => ({}))) as OpenAiPayload;
  if (!response.ok) {
    const message = payload.error?.message
      ? redactReliabilityText(payload.error.message, 500)
      : `status=${response.status}`;
    throw new Error(`OpenAI 신뢰성 분석 요청에 실패했습니다: ${message}`);
  }
  return parseReliabilityLearningAnalysis(payload, job.risk_level);
}

async function completeAnalysis(
  admin: NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>,
  jobId: string,
  model: string,
  analysis: ReliabilityLearningAnalysis,
) {
  const result = await admin.rpc("complete_reliability_learning_analysis", {
    p_job_id: jobId,
    p_model: model,
    p_analysis: analysis,
  });
  if (result.error) {
    throw new Error(`학습 분석 결과를 저장하지 못했습니다: ${result.error.message}`);
  }
}

async function failAnalysis(
  admin: NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>,
  jobId: string,
  error: unknown,
) {
  const message = redactReliabilityText(
    error instanceof Error ? error.message : String(error ?? "unknown error"),
    1_500,
  );
  const result = await admin.rpc("fail_reliability_learning_analysis", {
    p_job_id: jobId,
    p_error: message || "unknown analysis failure",
  });
  if (result.error) {
    throw new Error(`학습 분석 실패 상태를 저장하지 못했습니다: ${result.error.message}`);
  }
}

export function reliabilityLearningAnalyzerConfigured() {
  return Boolean(openAiConfiguration());
}

export async function runReliabilityLearningAnalyzer(): Promise<ReliabilityLearningAnalyzerResult> {
  const config = openAiConfiguration();
  if (!config) {
    return {
      ok: true,
      configured: false,
      claimed: 0,
      succeeded: 0,
      failed: 0,
      model: null,
      message:
        "신뢰성 분석용 OpenAI 키가 설정되지 않아 학습 후보를 대기 상태로 유지했습니다.",
    };
  }

  const { admin, jobs } = await claimAnalysisJobs();
  if (!jobs.length) {
    return {
      ok: true,
      configured: true,
      claimed: 0,
      succeeded: 0,
      failed: 0,
      model: config.model,
      message: "분석할 반복 사건이 없습니다.",
    };
  }

  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const analysis = await requestOpenAiAnalysis(job, config);
      await completeAnalysis(admin, job.job_id, config.model, analysis);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      await failAnalysis(admin, job.job_id, error).catch(() => undefined);
    }
  }

  return {
    ok: failed === 0,
    configured: true,
    claimed: jobs.length,
    succeeded,
    failed,
    model: config.model,
    message:
      failed === 0
        ? `반복 사건 ${succeeded}건을 학습 자산으로 구조화했습니다.`
        : `반복 사건 ${succeeded}건 분석 완료, ${failed}건은 재시도 큐로 돌렸습니다.`,
  };
}
