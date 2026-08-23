import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ReliabilityImpactEvaluatorResult = {
  ok: boolean;
  processed: number;
  verified: number;
  regressed: number;
  measuring: number;
  message: string;
};

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export async function runReliabilityImpactEvaluator(): Promise<ReliabilityImpactEvaluatorResult> {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return {
      ok: false,
      processed: 0,
      verified: 0,
      regressed: 0,
      measuring: 0,
      message: "OPS CENTER Supabase 관리자 연결이 설정되지 않았습니다.",
    };
  }

  const result = await admin.rpc(
    "refresh_reliability_improvement_measurements",
    {},
  );
  if (result.error) {
    return {
      ok: false,
      processed: 0,
      verified: 0,
      regressed: 0,
      measuring: 0,
      message: `개선 효과 측정에 실패했습니다: ${result.error.message}`,
    };
  }

  const payload =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : {};
  const processed = numberOrZero(payload.processed);
  const verified = numberOrZero(payload.verified);
  const regressed = numberOrZero(payload.regressed);
  const measuring = numberOrZero(payload.measuring);

  return {
    ok: payload.ok !== false,
    processed,
    verified,
    regressed,
    measuring,
    message:
      processed > 0
        ? `적용된 개선 ${processed}건의 전후 지표를 갱신했습니다. 검증 ${verified}건, 측정 중 ${measuring}건, 악화 ${regressed}건입니다.`
        : "아직 효과를 측정할 실제 반영 항목이 없습니다.",
  };
}
