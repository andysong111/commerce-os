export const DETAIL_PAGE_JOB_SEARCH_MIN_LENGTH = 2;

export type DetailPageJobSearchFilter = {
  field:
    | "id"
    | "launch_item_id"
    | "payload->>product_name_hint"
    | "payload->>product_name";
  value: string;
};

export function normalizeDetailPageJobSearchQuery(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function detailPageJobSearchFilters(
  value: unknown,
): DetailPageJobSearchFilter[] {
  const query = normalizeDetailPageJobSearchQuery(value);
  if (query.length < DETAIL_PAGE_JOB_SEARCH_MIN_LENGTH) return [];

  const filters: DetailPageJobSearchFilter[] = [
    { field: "launch_item_id", value: `ilike.*${query}*` },
    {
      field: "payload->>product_name_hint",
      value: `ilike.*${query}*`,
    },
    { field: "payload->>product_name", value: `ilike.*${query}*` },
  ];

  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      query,
    )
  ) {
    filters.unshift({ field: "id", value: `eq.${query}` });
  }

  return filters;
}
