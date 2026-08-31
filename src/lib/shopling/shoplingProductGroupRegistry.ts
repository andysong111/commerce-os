import {
  normalizeInternalPriceGroup,
  type InternalPriceGroup,
} from "@/lib/internalChinaPriceGroupPolicy";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export type ShoplingProductGroupRegistryRow = {
  owner_id: string;
  goods_key: string;
  product_group_key: string;
  product_group_label: string;
  ptn_goods_cd: string;
  code_format: string;
  updated_at: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function connection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function getRows(query: URLSearchParams) {
  const { baseUrl, secret } = connection();
  const response = await fetch(
    `${baseUrl}/rest/v1/shopling_product_group_registry?${query.toString()}`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `SHOPLING_PRODUCT_GROUP_REGISTRY_READ_FAILED:${response.status}:${raw.slice(0, 300)}`,
    );
  }
  return (raw ? JSON.parse(raw) : []) as ShoplingProductGroupRegistryRow[];
}

export async function loadShoplingProductGroupsByGoodsKey(
  goodsKeys: Iterable<string>,
): Promise<Map<string, InternalPriceGroup>> {
  const unique = [...new Set([...goodsKeys].map(text).filter((key) => /^\d{5,9}$/.test(key)))];
  const result = new Map<string, InternalPriceGroup>();
  for (let offset = 0; offset < unique.length; offset += 100) {
    const chunk = unique.slice(offset, offset + 100);
    if (!chunk.length) continue;
    const rows = await getRows(
      new URLSearchParams({
        select: "owner_id,goods_key,product_group_key,product_group_label,ptn_goods_cd,code_format,updated_at",
        goods_key: `in.(${chunk.join(",")})`,
      }),
    );
    for (const row of rows) {
      const group = normalizeInternalPriceGroup(row.product_group_label);
      if (group) result.set(text(row.goods_key), group);
    }
  }
  return result;
}

export function resolveInternalPriceGroup(input: {
  goodsKey: unknown;
  listingProductGroup?: unknown;
  registry: ReadonlyMap<string, InternalPriceGroup>;
}) {
  const goodsKey = text(input.goodsKey);
  const registered = input.registry.get(goodsKey) ?? null;
  if (registered) {
    return {
      group: registered,
      source: "OPS_REGISTRY" as const,
    };
  }
  const listing = normalizeInternalPriceGroup(input.listingProductGroup);
  if (listing) {
    return {
      group: listing,
      source: "EXACT_LISTING_GROUP" as const,
    };
  }
  return {
    group: null,
    source: "UNRESOLVED" as const,
  };
}
