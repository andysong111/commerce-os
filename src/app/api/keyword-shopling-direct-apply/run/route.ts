import { NextResponse } from "next/server";
import { dispatchKeywordShoplingDirectApply } from "@/lib/keywordShoplingDirectApplyRunner";
import { validateNoSpaceExecutionPlan } from "@/lib/productLaunchNoSpaceKeywordPolicy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: {
    execution_plan_json?: unknown;
    confirmation_text?: unknown;
    max_items?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "요청 JSON을 읽을 수 없습니다." },
      { status: 400 },
    );
  }

  const noSpaceValidation = validateNoSpaceExecutionPlan(
    body.execution_plan_json,
  );
  if (!noSpaceValidation.ok) {
    return NextResponse.json(
      {
        status: "error",
        message: noSpaceValidation.message,
        goods_key: noSpaceValidation.goodsKey,
        keyword: noSpaceValidation.keyword,
      },
      { status: 400 },
    );
  }

  const result = await dispatchKeywordShoplingDirectApply(body);
  return NextResponse.json(result, {
    status: result.status === "queued" ? 200 : 400,
  });
}
