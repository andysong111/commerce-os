import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";
import { dispatchShoplingPriceBulkNormal } from "@/lib/shoplingPriceModifyBulkNormal";
import { generateShoplingPriceModifyRequestId } from "@/lib/shoplingPriceModifyRunner";
export const runtime="nodejs";
export async function POST(_request:Request,{params}:{params:Promise<{jobId:string}>}) {
 const auth=await normalSession(); if(auth.response)return auth.response; const {jobId}=await params; const requestId=generateShoplingPriceModifyRequestId();
 const reserved=await auth.admin!.rpc("reserve_next_shopling_price_bulk_normal_chunk",{p_job_id:jobId,p_owner_id:auth.ownerId,p_request_id:requestId});
 if(reserved.error||!reserved.data)return normalError("다음 일반 청크를 예약할 수 없습니다.",409,"NORMAL_RESERVE_REJECTED","normal.advance.reserve",reserved.error);
 const context=rpcData(reserved.data); if(context.completed)return NextResponse.json({status:"normal_succeeded",message:"모든 상품의 가격설정 작업이 완료되었습니다."});
 if(context.paused)return NextResponse.json({status:"normal_paused",message:"직렬 실행이 안전하게 일시중지되었습니다."});
 const keys=Array.isArray(context.goods_keys)?context.goods_keys.filter((v):v is string=>typeof v==="string"):[];
 const dispatched=await dispatchShoplingPriceBulkNormal(keys,context.policy_overrides,requestId);
 if(dispatched.status==="queued") {
  const marked=await auth.admin!.rpc("mark_shopling_price_bulk_normal_running",{p_job_id:jobId,p_owner_id:auth.ownerId,p_request_id:requestId,p_actions_url:dispatched.githubActionsUrl});
  if(marked.error){const blocked=await auth.admin!.rpc("block_shopling_price_bulk_normal_uncertain",{p_job_id:jobId,p_owner_id:auth.ownerId,p_request_id:requestId,p_error:"GitHub 요청 수락 후 DB 상태 저장 실패"});if(blocked.error)return normalError("요청 수락 후 실패 상태 전이에 실패했습니다. 재전송하지 마세요.",500,"NORMAL_STATE_TRANSITION_FAILED","normal.advance.failure_transition",blocked.error);return normalError("요청 수락 후 상태 저장이 불확실합니다. 재전송하지 마세요.",202,"DISPATCH_UNCERTAIN","normal.advance.mark_running",marked.error);}
  return NextResponse.json({status:"running",chunk_index:context.chunk_index,goods_key_count:keys.length,request_id:requestId,actions_url:dispatched.githubActionsUrl,message:dispatched.message});
 }
 const rpc=dispatched.status==="rejected"?"fail_shopling_price_bulk_normal_dispatch_rejected":"block_shopling_price_bulk_normal_uncertain";
 const transitioned=await auth.admin!.rpc(rpc,{p_job_id:jobId,p_owner_id:auth.ownerId,p_request_id:requestId,p_error:dispatched.message});
 if(transitioned.error)return normalError("일반 청크 실패 상태 전이에 실패했습니다. 재전송하지 마세요.",500,"NORMAL_STATE_TRANSITION_FAILED","normal.advance.failure_transition",transitioned.error);
 return normalError(dispatched.status==="rejected"?"GitHub가 일반 청크 요청을 거절했습니다.":"전송 여부를 확정할 수 없습니다. 재전송하지 마세요.",dispatched.status==="rejected"?502:202,dispatched.status==="rejected"?"DISPATCH_REJECTED":"DISPATCH_UNCERTAIN","normal.advance.dispatch",dispatched.message);
}
