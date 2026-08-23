import {
  reliabilityLearningAnalyzerConfigured,
  runReliabilityLearningAnalyzer,
} from "@/lib/reliability/reliabilityLearningAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  return Boolean(expected && authorization === `Bearer ${expected}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  if (!reliabilityLearningAnalyzerConfigured()) {
    return Response.json(
      {
        ok: true,
        configured: false,
        processed: false,
        message:
          "신뢰성 분석용 OpenAI 키가 없어 학습 후보를 안전하게 대기 상태로 유지했습니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await runReliabilityLearningAnalyzer();
    return Response.json(result, {
      status: result.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "RELIABILITY_LEARNING_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "신뢰성 학습 분석 Worker 실행에 실패했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
