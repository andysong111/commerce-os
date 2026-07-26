import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateShoplingPriceModifyRequestId, dispatchReservedShoplingPriceModifyActions } from "@/lib/shoplingPriceModifyRunner";
import type { BulkDb } from "@/lib/shoplingPriceModifyBulkServer";

export async function POST(request:Request) {
  const secret=process.env.SHOPLING_PRICE_BULK_CRON_SECRET;
  if(!secret || request.headers.get("authorization")!==`Bearer ${secret}`) return NextResponse.json({message:"Unauthorized"},{status:401});
  const admin=await createSupabaseAdminClient(); if(!admin)return NextResponse.json({message:"Supabase unavailable"},{status:503});
  const db=admin as BulkDb; const requestId=generateShoplingPriceModifyRequestId();
  const {data,error}=await db.rpc("claim_shopling_price_bulk_chunk",{p_request_id:requestId});
  if(error)return NextResponse.json({message:error.message},{status:500});
  const chunk=Array.isArray(data)?data[0] as Record<string,unknown>|undefined:undefined;
  if(!chunk)return NextResponse.json({status:"idle"});
  const jobResult=await db.from("shopling_price_bulk_jobs").select("policy_overrides").eq("id",chunk.job_id).single();
  try { await dispatchReservedShoplingPriceModifyActions((chunk.goods_keys as string[]).join(","),jobResult.data?.policy_overrides??[],requestId); return NextResponse.json({status:"dispatched",requestId}); }
  catch(error) { await db.rpc("pause_shopling_price_bulk_dispatch_uncertain",{p_chunk_id:chunk.id,p_error:error instanceof Error?error.message:"dispatch failed"}); return NextResponse.json({status:"paused",message:"Dispatch 결과가 불명확하여 중복 실행 방지를 위해 중지했습니다."},{status:503}); }
}
