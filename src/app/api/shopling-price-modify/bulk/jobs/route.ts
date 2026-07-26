import { NextResponse } from "next/server";
import { requireBulkOperator } from "@/lib/shoplingPriceModifyBulkAuth";
import { bulkRpc } from "@/lib/shoplingPriceModifyBulkDb";
import { normalizeBulkGoodsKeys } from "@/lib/shoplingPriceModifyBulk";
import { validateShoplingPriceModifyPolicyOverrides } from "@/lib/shoplingPriceModifyRunner";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = await requireBulkOperator(); if ("response" in auth) return auth.response;
  try { const body = await request.json(); const parsed = normalizeBulkGoodsKeys(Array.isArray(body.goods_keys) ? body.goods_keys : []); if (!parsed.goodsKeys.length) return NextResponse.json({ message: "유효한 goods_key가 없습니다.", invalid: parsed.invalid }, { status: 400 }); const policies = validateShoplingPriceModifyPolicyOverrides(body.policy_overrides); const data = await bulkRpc("shopling_price_bulk_create_job", { p_owner_id: auth.user.id, p_goods_keys: parsed.goodsKeys, p_policy_overrides: policies, p_retry_of_job_id: null }); return NextResponse.json(data, { status: 201 }); } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "작업 생성 실패" }, { status: 400 }); }
}
export async function GET() { const auth = await requireBulkOperator(); if ("response" in auth) return auth.response; try { return NextResponse.json(await bulkRpc("shopling_price_bulk_recent_jobs", { p_owner_id: auth.user.id })); } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "조회 실패" }, { status: 500 }); } }
