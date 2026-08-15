import { NextResponse } from "next/server";
import {
  KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS,
  KEYWORD_ENGINE_ELON_LAB_STAGES,
  isKeywordEngineElonLabGoodsKey,
  type KeywordEngineElonLabReviewStatus,
} from "@/lib/keywordEngineElonLab";
import { loadKeywordEngineElonLabShoplingContexts } from "@/lib/keywordEngineElonLabShopling";
import {
  listKeywordEngineElonLabRows,
  updateKeywordEngineElonLabReview,
  upsertKeywordEngineElonLabRows,
  type KeywordEngineElonLabStoredRow,
} from "@/lib/keywordEngineElonLabStore";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const maxDuration = 60;

const STAGE_ONE = KEYWORD_ENGINE_ELON_LAB_STAGES.find((stage) => stage.index === 1)!;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });
}

function assertSameOrigin(request: Request) {
  return isSameOriginOpsRequest(request);
}

export async function GET(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("OPS Center 화면에서만 조회할 수 있습니다.", 403);
  try {
    const rows = await listKeywordEngineElonLabRows();
    return NextResponse.json(
      {
        ok: true,
        goodsKeys: KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS,
        stages: KEYWORD_ENGINE_ELON_LAB_STAGES,
        rows,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "실험 이력을 불러오지 못했습니다.", 500);
  }
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return jsonError("OPS Center 화면에서만 실행할 수 있습니다.", 403);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("요청 JSON을 읽을 수 없습니다.");
  }

  const action = String(body.action ?? "").trim();
  if (action === "run_stage") {
    const stageKey = String(body.stageKey ?? "").trim();
    if (stageKey !== STAGE_ONE.key) {
      return jsonError("현재 실험실에서 실제 실행이 연결된 단계는 1단계 Shopling 상품 Context 조회뿐입니다.", 409);
    }
    const requested = Array.isArray(body.goodsKeys)
      ? body.goodsKeys.map((value) => String(value ?? "").trim())
      : [...KEYWORD_ENGINE_ELON_LAB_GOODS_KEYS];
    const goodsKeys = [...new Set(requested.filter(isKeywordEngineElonLabGoodsKey))];
    if (!goodsKeys.length) return jsonError("고정 테스트 goods_key가 없습니다.");

    const inputPayload = {
      source: "Shopling prod_gather_api",
      requestedFields: ["goods_key", "ptn_goods_cd", "prod_nm", "model_no", "model_nm", "site_srch", "sale_status", "dtl_desc"],
      writesEnabled: false,
    };

    try {
      const contexts = await loadKeywordEngineElonLabShoplingContexts(goodsKeys);
      const rows: KeywordEngineElonLabStoredRow[] = contexts.map((context) => ({
        goods_key: context.goodsKey,
        stage_key: STAGE_ONE.key,
        stage_index: STAGE_ONE.index,
        run_status: context.found ? "ready" : "error",
        review_status: "pending",
        input_payload: { goods_key: context.goodsKey, ...inputPayload },
        output_payload: context,
        error_message: context.found ? "" : "Shopling에서 goods_key를 찾지 못했습니다.",
        review_note: "",
        engine_revision: "ops-stage1-shopling-context-v1",
      }));
      await upsertKeywordEngineElonLabRows(rows);
      return NextResponse.json({ ok: true, stage: STAGE_ONE, rows }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shopling Context 조회에 실패했습니다.";
      const errorRows: KeywordEngineElonLabStoredRow[] = goodsKeys.map((goodsKey) => ({
        goods_key: goodsKey,
        stage_key: STAGE_ONE.key,
        stage_index: STAGE_ONE.index,
        run_status: "error",
        review_status: "pending",
        input_payload: { goods_key: goodsKey, ...inputPayload },
        output_payload: {},
        error_message: message,
        review_note: "",
        engine_revision: "ops-stage1-shopling-context-v1",
      }));
      try {
        await upsertKeywordEngineElonLabRows(errorRows);
      } catch {
        // Preserve the original Shopling error even if persistence is unavailable.
      }
      return jsonError(message, 502);
    }
  }

  if (action === "review_stage") {
    const goodsKey = String(body.goodsKey ?? "").trim();
    const stageKey = String(body.stageKey ?? "").trim();
    const reviewStatus = String(body.reviewStatus ?? "").trim() as KeywordEngineElonLabReviewStatus;
    const reviewNote = String(body.reviewNote ?? "").trim().slice(0, 2000);
    if (!isKeywordEngineElonLabGoodsKey(goodsKey)) return jsonError("허용되지 않은 테스트 goods_key입니다.");
    if (!KEYWORD_ENGINE_ELON_LAB_STAGES.some((stage) => stage.key === stageKey)) return jsonError("알 수 없는 단계입니다.");
    if (!(["pending", "pass", "improve"] as string[]).includes(reviewStatus)) return jsonError("검수 상태가 올바르지 않습니다.");
    try {
      const rows = await updateKeywordEngineElonLabReview({ goodsKey, stageKey, reviewStatus, reviewNote });
      return NextResponse.json({ ok: true, rows }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "검수 판정을 저장하지 못했습니다.", 500);
    }
  }

  return jsonError("지원하지 않는 action입니다.");
}
