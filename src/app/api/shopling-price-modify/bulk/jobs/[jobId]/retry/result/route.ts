import { NextResponse } from "next/server";
import { normalError, normalSession, requireManualShoplingPriceBulkJob, rpcData } from "@/lib/shoplingPriceModifyBulkApi";
import { analyzeShoplingPriceBulkRetryResult } from "@/lib/shoplingPriceModifyBulkRetry";
import { fetchShoplingPriceModifyActionsResult } from "@/lib/shoplingPriceModifyRunner";
import { decideNormalDispatchingReconciliation } from "@/lib/shoplingPriceModifyBulkReconciliation";
export const runtime="nodejs";
export async function POST(_request:Request,{params}:{params:Promise<{jobId:string}>}) {
 const auth=await normalSession();if(auth.response)return auth.response;const {jobId}=await params;
 const manual=await requireManualShoplingPriceBulkJob(auth.admin!,jobId,auth.ownerId,"retry.result");if(manual.response)return manual.response;
 if(!["retry_running","dispatch_uncertain"].includes(String(manual.job.status)))return normalError("현재 상태에서는 재시도 청크 결과를 확인할 수 없습니다.",409,"INVALID_JOB_STATUS","retry.result.job_query");
 const chunkResult=await auth.admin!.from("shopling_price_bulk_chunks").select("chunk_index,goods_keys,goods_key_count,request_id,status,started_at,updated_at").eq("job_id",jobId).eq("chunk_type","retry").in("status",["dispatching","running","dispatch_uncertain"]).order("chunk_index",{ascending:true}).limit(2);
 if(chunkResult.error)return normalError("활성 재시도 청크 조회에 실패했습니다.",500,"CHUNK_QUERY_FAILED","retry.result.chunk_query",chunkResult.error);
 const chunks=Array.isArray(chunkResult.data)?chunkResult.data:[];if(chunks.length!==1)return normalError("활성 재시도 청크가 정확히 하나여야 합니다.",409,"ACTIVE_CHUNK_INVALID","retry.result.chunk_query");
 const chunk=chunks[0] as Record<string,unknown>;const requestId=typeof chunk.request_id==="string"?chunk.request_id:"";const keys=Array.isArray(chunk.goods_keys)?chunk.goods_keys.filter((v):v is string=>typeof v==="string"):[];
 if(!requestId||keys.length===0)return normalError("재시도 청크 요청 정보가 불완전합니다.",409,"CHUNK_CONTEXT_INVALID","retry.result.chunk_query");
 const actions=await fetchShoplingPriceModifyActionsResult(requestId);
 if(actions.status==="pending") {
  const reconciliation=decideNormalDispatchingReconciliation({chunkStatus:chunk.status,startedAt:chunk.started_at,now:Date.now()});
  if(reconciliation==="wait")return NextResponse.json({status:"pending",request_id:requestId,message:"전송 예약 직후입니다. 기존 request_id 결과만 계속 확인합니다."});
  if(reconciliation==="block_uncertain") {
   const reason=typeof chunk.started_at==="string"&&Number.isFinite(Date.parse(chunk.started_at))?"dispatching 상태가 120초 이상 지속되어 재전송을 차단합니다.":"dispatching 시작 시각이 없어 안전하게 재전송을 차단합니다.";
   const blocked=await auth.admin!.rpc("block_shopling_price_bulk_retry_uncertain",{p_job_id:jobId,p_owner_id:auth.ownerId,p_request_id:requestId,p_error:reason});
   if(blocked.error)return normalError("재시도 청크 전송 상태를 안전하게 차단하지 못했습니다.",500,"RETRY_DISPATCHING_RECONCILE_FAILED","retry.result.dispatching_reconcile",blocked.error);
   return NextResponse.json({status:"pending",request_id:requestId,message:"전송 여부가 불확실하여 재전송을 차단했습니다. 기존 request_id 결과만 계속 확인합니다."});
  }
  return NextResponse.json({status:"pending",request_id:requestId,message:"결과가 아직 준비되지 않았습니다."});
 }
 if(actions.status==="error"||!actions.summary)return normalError(actions.message??"결과를 가져오지 못했습니다.",502,"ACTIONS_RESULT_FAILED","retry.result.actions_result");
 const analysis=analyzeShoplingPriceBulkRetryResult(actions.summary,requestId,keys,actions.runConclusion);
 const finished=await auth.admin!.rpc("finish_shopling_price_bulk_retry_chunk",{p_job_id:jobId,p_owner_id:auth.ownerId,p_request_id:requestId,p_success:analysis.success,p_failure_scope_known:analysis.failureScopeKnown,p_failed_keys:analysis.failedKeys,p_summary:actions.summary,p_run_url:actions.runUrl??null,p_error:analysis.success?null:analysis.message});
 if(finished.error)return normalError("재시도 청크 결과 저장에 실패했습니다.",500,"FINISH_FAILED","retry.result.finish",finished.error);
 if(!finished.data)return normalError("재시도 청크 결과 저장 응답이 비어 있습니다.",500,"RETRY_FINISH_EMPTY","retry.result.finish","finish_shopling_price_bulk_retry_chunk RPC가 데이터를 반환하지 않았습니다.");
 const state=rpcData(finished.data);return NextResponse.json({status:analysis.success?(state.status==="normal_succeeded"?"normal_succeeded":"chunk_succeeded"):"retry_failed",completed_chunk_index:chunk.chunk_index,completed_goods_key_count:keys.length,remaining_chunk_count:state.remaining_chunk_count,request_id:requestId,run_url:actions.runUrl,message:analysis.success?(state.status==="normal_succeeded"?"모든 상품의 가격설정 작업이 완료되었습니다.":"청크 성공을 확인했습니다."):analysis.message});
}
