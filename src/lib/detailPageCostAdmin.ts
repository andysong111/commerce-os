export const DEFAULT_DETAIL_PAGE_COST_ADMIN_EMAIL = "andy0801a@gmail.com";
export const DEFAULT_DETAIL_PAGE_USD_KRW_RATE = 1400;

export type DetailPageCostRow = {
  id: number | string;
  run_id: string;
  event_type:
    | "product_analysis"
    | "image_generation"
    | "visual_verifier"
    | "color_verifier";
  generation_profile: string;
  model: string;
  slot: number | null;
  product_name: string;
  output_language: string;
  estimated_cost_usd: number | string | null;
  pricing_status: "estimated" | "unpriced";
  pricing_version: string;
  created_at: string;
};

export type DetailPageCostSummary = {
  total_cost_usd: number;
  today_cost_usd: number;
  run_count: number;
  today_run_count: number;
  event_count: number;
  unpriced_event_count: number;
};

export type DetailPageCostRun = {
  run_id: string;
  product_name: string;
  output_language: string;
  generation_profile: string;
  created_at: string;
  cost_usd: number;
  event_count: number;
  image_calls: number;
  verifier_calls: number;
  has_unpriced_event: boolean;
};

const numberValue = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function detailPageCostAdminEmail() {
  return (
    process.env.DETAIL_PAGE_COST_ADMIN_EMAIL?.trim().toLowerCase() ||
    DEFAULT_DETAIL_PAGE_COST_ADMIN_EMAIL
  );
}

export function isDetailPageCostAdmin(email: string | null | undefined) {
  return email?.trim().toLowerCase() === detailPageCostAdminEmail();
}

export function detailPageUsdKrwRate() {
  const configured = Number(process.env.DETAIL_PAGE_USD_KRW_RATE);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_DETAIL_PAGE_USD_KRW_RATE;
}

export function normalizeDetailPageCostSummary(
  value: unknown,
): DetailPageCostSummary {
  const row =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    total_cost_usd: numberValue(row.total_cost_usd),
    today_cost_usd: numberValue(row.today_cost_usd),
    run_count: Math.round(numberValue(row.run_count)),
    today_run_count: Math.round(numberValue(row.today_run_count)),
    event_count: Math.round(numberValue(row.event_count)),
    unpriced_event_count: Math.round(numberValue(row.unpriced_event_count)),
  };
}

export function normalizeDetailPageCostRuns(
  value: unknown,
): DetailPageCostRun[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const runId = typeof row.run_id === "string" ? row.run_id : "";
    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    if (!runId || !createdAt) return [];
    return [
      {
        run_id: runId,
        product_name:
          typeof row.product_name === "string" ? row.product_name : "",
        output_language:
          typeof row.output_language === "string" ? row.output_language : "",
        generation_profile:
          typeof row.generation_profile === "string"
            ? row.generation_profile
            : "",
        created_at: createdAt,
        cost_usd: numberValue(row.cost_usd),
        event_count: Math.round(numberValue(row.event_count)),
        image_calls: Math.round(numberValue(row.image_calls)),
        verifier_calls: Math.round(numberValue(row.verifier_calls)),
        has_unpriced_event: row.has_unpriced_event === true,
      },
    ];
  });
}

export function aggregateRecentDetailPageCostRuns(
  rows: DetailPageCostRow[],
): DetailPageCostRun[] {
  const runs = new Map<string, DetailPageCostRun>();
  for (const row of rows) {
    const existing = runs.get(row.run_id);
    const next = existing ?? {
      run_id: row.run_id,
      product_name: row.product_name,
      output_language: row.output_language,
      generation_profile: row.generation_profile,
      created_at: row.created_at,
      cost_usd: 0,
      event_count: 0,
      image_calls: 0,
      verifier_calls: 0,
      has_unpriced_event: false,
    };
    next.cost_usd += numberValue(row.estimated_cost_usd);
    next.event_count += 1;
    next.image_calls += row.event_type === "image_generation" ? 1 : 0;
    next.verifier_calls +=
      row.event_type === "visual_verifier" ||
      row.event_type === "color_verifier"
        ? 1
        : 0;
    next.has_unpriced_event ||= row.pricing_status === "unpriced";
    if (row.created_at > next.created_at) next.created_at = row.created_at;
    runs.set(row.run_id, next);
  }
  return [...runs.values()].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}
