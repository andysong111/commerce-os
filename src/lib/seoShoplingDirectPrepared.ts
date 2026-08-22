import {
  buildKeywordShoplingDirectApplyDispatch,
  KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
} from "@/lib/keywordShoplingDirectApplyRunner";
import {
  buildSeoShoplingDirectPlan,
  type SeoShoplingGoodsKeys,
} from "@/lib/seoShoplingLiveRegistration";

export type PreparedSeoShoplingDirectApply = ReturnType<typeof buildKeywordShoplingDirectApplyDispatch> & {
  plan: ReturnType<typeof buildSeoShoplingDirectPlan>;
};

export function prepareSeoShoplingDirectApply(items: unknown, goodsKeys: SeoShoplingGoodsKeys): PreparedSeoShoplingDirectApply {
  if (process.env.KEYWORD_SHOPLING_APPLY_ENABLED?.trim() !== "1") {
    throw new Error("KEYWORD_SHOPLING_APPLY_ENABLED=1인 Production에서만 쇼핑몰별 상품명·검색어 실제 반영을 실행할 수 있습니다.");
  }
  const plan = buildSeoShoplingDirectPlan(items, goodsKeys);
  const request = buildKeywordShoplingDirectApplyDispatch({
    execution_plan_json: JSON.stringify(plan),
    confirmation_text: KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
    max_items: plan.length,
  });
  return { ...request, plan };
}

export async function dispatchPreparedSeoShoplingDirectApply(prepared: PreparedSeoShoplingDirectApply) {
  const response = await fetch(prepared.url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${prepared.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(prepared.body),
    cache: "no-store",
  });
  if (![200, 204].includes(response.status)) {
    const body = await response.text();
    throw new Error(`쇼핑몰별 상품명·검색어 GitHub Actions 실행 요청에 실패했습니다. status=${response.status}${body ? ` body=${body.slice(0, 220)}` : ""}`);
  }
  return {
    status: "queued" as const,
    phase: "queued" as const,
    requestId: prepared.requestId,
    githubActionsUrl: prepared.githubActionsUrl,
    runUrl: prepared.githubActionsUrl,
    itemCount: prepared.itemCount,
    plan: prepared.plan,
    message: "상품명과 검색어 실제 반영을 시작했습니다.",
  };
}
