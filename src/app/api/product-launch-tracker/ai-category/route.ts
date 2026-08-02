import { NextRequest } from "next/server";
import {
  fetchShoplingCategorySnapshot,
  generateShoplingCategoryRecommendations,
} from "@/lib/shoplingCategoryCatalog";
import {
  parseProductCategoryInputs,
  shortlistShoplingCategories,
} from "@/lib/shoplingCategoryScoring";
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
    const inputs = parseProductCategoryInputs(body);
    const snapshot = await fetchShoplingCategorySnapshot();
    if (!snapshot) {
      throw new Error(
        "샵플링 카테고리 스냅샷이 없습니다. 먼저 카테고리 업데이트를 실행하세요.",
      );
    }

    const supportedInputs = inputs.filter(
      (input) => shortlistShoplingCategories(input, snapshot.categories).length > 0,
    );
    const unsupportedIds = new Set(
      inputs
        .filter(
          (input) => shortlistShoplingCategories(input, snapshot.categories).length === 0,
        )
        .map((input) => input.itemId),
    );

    const generated = supportedInputs.length
      ? await generateShoplingCategoryRecommendations(
          { items: supportedInputs },
          { timeoutMs: 45_000 },
        )
      : {
          status: "success" as const,
          snapshot: {
            collectedAt: snapshot.collectedAt,
            categoryCount: snapshot.categoryCount,
            hash: snapshot.hash,
          },
          autoApplyConfidence: 90,
          results: [],
        };

    const generatedById = new Map(
      generated.results.map((row) => [row.itemId, row]),
    );
    const results = inputs.map((input) => {
      if (unsupportedIds.has(input.itemId)) {
        return {
          itemId: input.itemId,
          modelNumber: input.modelNumber,
          selectedPath: "",
          confidence: 0,
          reason:
            "모델명의 핵심 제품명사와 일치하는 샵플링 표준카테고리를 찾지 못했습니다. 엉뚱한 후보는 제시하지 않고 검토 상태로 남겼습니다.",
          alternatives: [],
          candidatePaths: [],
          candidateChoices: [],
          autoApply: false,
          skippedExisting: Boolean(input.currentCategory),
        };
      }

      const row = generatedById.get(input.itemId);
      if (!row) {
        throw new Error(`${input.modelNumber || input.itemId}의 AI 결과가 누락되었습니다.`);
      }
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
      { ok: true, ...generated, results },
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
