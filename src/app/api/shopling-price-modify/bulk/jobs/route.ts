import { NextResponse } from "next/server";
import { validateShoplingPriceModifyPolicyOverrides } from "@/lib/shoplingPriceModifyRunner";
import { validateBulkCreateInput } from "@/lib/shoplingPriceModifyBulk";
import { requireBulkUser } from "@/lib/shoplingPriceModifyBulkServer";

export async function POST(request: Request) {
  const auth = await requireBulkUser(); if (!auth.ok) return NextResponse.json({message:auth.message},{status:auth.status});
  try {
    const value = validateBulkCreateInput(await request.json());
    const policies = validateShoplingPriceModifyPolicyOverrides(value.policyOverrides);
    const { data, error } = await auth.db.rpc("create_shopling_price_bulk_job", { p_owner_id: auth.userId, p_goods_keys: value.goodsKeys, p_policy_overrides: policies });
    if (error) throw new Error(error.message);
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) { return NextResponse.json({message:error instanceof Error?error.message:"잘못된 요청입니다."},{status:400}); }
}
export async function GET() {
  const auth = await requireBulkUser(); if (!auth.ok) return NextResponse.json({message:auth.message},{status:auth.status});
  const {data,error}=await auth.db.from("shopling_price_bulk_jobs").select("*").eq("owner_id",auth.userId).order("created_at",{ascending:false}).limit(20);
  return error?NextResponse.json({message:error.message},{status:500}):NextResponse.json({jobs:data});
}
