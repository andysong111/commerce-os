declare module "@/lib/productLaunchManualTitleState.mjs" {
  type ManualResult = {
    requestId?: string;
    phase?: string;
    status?: string;
    summary?: Record<string, unknown>;
    applyResults?: Array<Record<string, unknown>>;
  } | null;
  type PlanItem = {
    goods_key: string;
    mall_key: string;
    final_title: string;
    final_site_srch: string;
  };
  export function isTerminalManualTitleResult(result: ManualResult): boolean;
  export function shouldPollRestoredManualTitle(
    session: Record<string, unknown> | null,
  ): boolean;
  export function collectAcceptedManualTitleTargetKeys(
    previousKeys: string[],
    result: ManualResult,
  ): string[];
  export function buildManualRemainingRetryExecutionPlan(
    eligibleItems: PlanItem[],
    acceptedTargetKeys: string[],
  ): string;
  export function hasCompletedManualRemaining(
    acceptedTargetKeys: string[],
    expectedTitleTargetCount: number,
  ): boolean;
}
