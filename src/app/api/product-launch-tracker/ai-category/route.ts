import { NextRequest } from "next/server";
import { generateShoplingCategoryRecommendations } from "@/lib/shoplingCategoryCatalog";
import { resolveProductLaunchIdentity } from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) {
    return Response.json(identity.body, { status: identity.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, message: "요청 JSON을 읽을 수 없습니다." },
      { status: 400 },
    );
  }
  try {
    const result = await generateShoplingCategoryRecommendations(body, {
      timeoutMs: 45_000,
    });
    const results = result.results.map((row) => {
      const candidateChoices = buildCandidateChoices(
        row.selectedPath,
        row.alternatives,
        row.candidatePaths,
      );
      return {
        ...row,
        reason: normalizeModelNameTerminology(row.reason),
        alternatives: candidateChoices.slice(1, 3),
        candidateChoices,
      };
    });
    return Response.json(
      { ok: true, ...result, results },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "AI 카테고리 추천에 실패했습니다.";
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "AI 카테고리 분석 시간이 45초를 초과했습니다. 선택 상품 수를 줄여 다시 실행하세요."
        : rawMessage;
    const status = /OPENAI_API_KEY|카테고리 스냅샷|GITHUB_/.test(message)
      ? 503
      : /시간을 .*초과|AbortError|aborted/i.test(message)
        ? 504
        : 400;
    return Response.json(
      { ok: false, message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function buildCandidateChoices(
  selectedPath: string,
  alternatives: string[],
  candidatePaths: string[],
) {
  return [selectedPath, ...alternatives, ...candidatePaths]
    .map((value) => String(value ?? "").trim())
    .filter((value, index, array) => value && array.indexOf(value) === index)
    .slice(0, 3);
}

function normalizeModelNameTerminology(value: string) {
  return String(value ?? "")
    .replaceAll("상품명이", "모델명이")
    .replaceAll("상품명은", "모델명은")
    .replaceAll("상품명에", "모델명에")
    .replaceAll("상품명", "모델명");
}
