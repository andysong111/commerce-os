import { NextRequest } from "next/server";
import { enhanceShoplingCategoryRecommendations } from "@/lib/shoplingCategoryAccuracyV2";
import {
  buildShoplingCategoryApprovalExamples,
  computeShoplingCategoryAccuracyMetrics,
  SHOPLING_CATEGORY_ENGINE_VERSION,
} from "@/lib/shoplingCategoryLearning";
import {
  generateReliableShoplingCategoryRecommendations,
  isRetryableCategoryOutputError,
  type ReliableCategoryRecommendationResult,
} from "@/lib/shoplingCategoryRecommendationRunner";
import { generateNaverFirstShoplingCategoryRecommendations } from "@/lib/shoplingCategoryNaverFirst";
import { generateShoplingFirstCategoryRecommendations } from "@/lib/shoplingCategoryShoplingFirst";
import { parseProductCategoryInputs } from "@/lib/shoplingCategoryScoring";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";
export const maxDuration = 300;

type RecordLike = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
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
    const retryFailedIndividually = Boolean(
      body &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        (body as Record<string, unknown>).retryFailedIndividually,
    );
    const requestedCategoryMode = String(
      process.env.SHOPLING_CATEGORY_MODE || "shopling_first",
    )
      .trim()
      .toLocaleLowerCase("en-US");
    const categoryMode =
      requestedCategoryMode === "legacy" || requestedCategoryMode === "naver_first"
        ? requestedCategoryMode
        : "shopling_first";
    const naverModel =
      process.env.OPENAI_NAVER_CATEGORY_MODEL || "gpt-4.1-mini";
    const shoplingFirstModel =
      process.env.OPENAI_SHOPLING_FIRST_CATEGORY_MODEL ||
      process.env.OPENAI_CATEGORY_MODEL ||
      "gpt-4.1-mini";

    const learningState = await readLearningState(identity.value.userId).catch(
      () => null,
    );
    const approvalExamples = buildShoplingCategoryApprovalExamples(learningState);
    const accuracyMetrics = computeShoplingCategoryAccuracyMetrics(learningState);
    const enrichedInputs = inputs.map((input) => ({
      ...input,
      imageUrl: resolveTrackerImageUrl(learningState, input.itemId),
    }));

    const generatedBase =
      categoryMode === "legacy"
        ? await generateReliableShoplingCategoryRecommendations(inputs, {
            timeoutMs: 60_000,
            retryFailedIndividually,
          })
        : categoryMode === "naver_first"
          ? await generateNaverFirstShoplingCategoryRecommendations(inputs, {
              timeoutMs: 22_000,
              model: naverModel,
            })
          : await generateShoplingFirstCategoryRecommendations(inputs, {
              timeoutMs: 45_000,
              validationTimeoutMs: 14_000,
              retryFailedIndividually,
              model: shoplingFirstModel,
              naverModel,
              // 네이버는 아래 정확도 파이프라인에서 후보 1·2·3 재랭킹 용도로 사용합니다.
              validateWithNaver: false,
            });

    const generated =
      categoryMode === "shopling_first"
        ? await enhanceShoplingCategoryRecommendations(
            enrichedInputs,
            generatedBase as ReliableCategoryRecommendationResult,
            {
              approvalExamples,
              model: shoplingFirstModel,
              naverModel,
            },
          )
        : generatedBase;

    const generatedById = new Map(
      generated.results.map((row) => [row.itemId, row]),
    );
    const results = inputs.flatMap((input) => {
      const row = generatedById.get(input.itemId);
      if (!row) return [];
      const candidateChoices = buildCandidateChoices(
        row.selectedPath,
        row.alternatives,
        row.candidatePaths,
      );
      return [
        {
          ...row,
          autoApply: false,
          reason: normalizeModelNameTerminology(row.reason),
          alternatives: candidateChoices.slice(1, 3),
          candidateChoices,
          engineVersion: SHOPLING_CATEGORY_ENGINE_VERSION,
        },
      ];
    });

    const failures = generated.failures.map((failure) => ({
      ...failure,
      message: normalizeModelNameTerminology(failure.message),
    }));

    console.info(
      JSON.stringify({
        event: "shopling_category_batch_complete",
        categoryMode,
        requestedCategoryMode,
        engineVersion: SHOPLING_CATEGORY_ENGINE_VERSION,
        approvalLearningExamples: approvalExamples.length,
        historicalApprovedCount: accuracyMetrics.approvedCount,
        historicalTop1Rate: accuracyMetrics.top1Rate,
        historicalTop3Rate: accuracyMetrics.top3Rate,
        inputCount: inputs.length,
        resultCount: results.length,
        failureCount: failures.length,
        durationMs: Date.now() - startedAt,
        retryFailedIndividually,
        failureCodes: failures.reduce<Record<string, number>>(
          (counts, failure) => {
            counts[failure.code] = (counts[failure.code] ?? 0) + 1;
            return counts;
          },
          {},
        ),
      }),
    );
    for (const failure of failures) {
      console.warn(
        JSON.stringify({
          event: "shopling_category_item_failed",
          categoryMode,
          itemId: failure.itemId,
          modelNumber: failure.modelNumber,
          stage: failure.stage,
          code: failure.code,
          retryable: failure.retryable,
          retryAfterMs: failure.retryAfterMs,
        }),
      );
    }

    return Response.json(
      {
        ok: true,
        ...generated,
        categoryMode,
        engineVersion: SHOPLING_CATEGORY_ENGINE_VERSION,
        accuracyMetrics,
        approvalLearningCount: approvalExamples.length,
        complete: failures.length === 0,
        results,
        failures,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "AI 카테고리 추천에 실패했습니다.";
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "카테고리 검색 제한시간을 초과했습니다. 완료된 상품은 보존하고 실패한 상품만 다시 실행하세요."
        : isRetryableCategoryOutputError(error)
          ? "AI 응답이 중간에서 잘렸습니다. 완료된 상품은 보존하고 실패한 상품만 다시 실행하세요."
          : rawMessage;
    const status = /OPENAI_API_KEY|카테고리 스냅샷|GITHUB_/.test(message)
      ? 503
      : /시간[이가을]? .*초과|AbortError|aborted/i.test(message)
        ? 504
        : 400;
    console.error(
      JSON.stringify({
        event: "shopling_category_batch_failed",
        durationMs: Date.now() - startedAt,
        status,
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: rawMessage.slice(0, 240),
      }),
    );
    return Response.json(
      { ok: false, message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function readLearningState(userId: string) {
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return null;
  const row = (await readProductLaunchState(config.value, userId)) as
    | { state_payload?: unknown }
    | null;
  return row?.state_payload ?? null;
}

function record(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function resolveTrackerImageUrl(state: unknown, itemId: string) {
  const source = record(state);
  const items = Array.isArray(source?.items) ? source!.items : [];
  const item = items
    .map(record)
    .find((candidate) => String(candidate?.id ?? "").trim() === itemId);
  if (!item) return "";
  const asset = record(item.detailPageAsset);
  const direct = [
    asset?.mainImageUrl,
    item.mainImageUrl,
    item.imageUrl,
    item.representativeImageUrl,
  ]
    .map((value) => String(value ?? "").trim())
    .find((value) => /^https:\/\/[^\s]+$/i.test(value));
  if (direct) return direct;
  const additional = Array.isArray(asset?.additionalImageUrls)
    ? asset!.additionalImageUrls
    : [];
  return (
    additional
      .map((value) => String(value ?? "").trim())
      .find((value) => /^https:\/\/[^\s]+$/i.test(value)) || ""
  );
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
