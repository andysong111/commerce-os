import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";
import { analyzeShoplingPriceBulkNormalResult } from "@/lib/shoplingPriceModifyBulkNormal";
import { fetchShoplingPriceModifyActionsResult } from "@/lib/shoplingPriceModifyRunner";
export const runtime="nodejs";
export async function POST(_request:Request,{params}:{params:Promise<{jobId:string}>}) {
 const auth=await normalSession();if(auth.response)return auth.response;const {jobId}=await params;
 const jobResult=await auth.admin!.from("shopling_price_bulk_jobs").select("id,status").eq("id",jobId).eq("owner_id",auth.ownerId).maybeSingle();
 if(jobResult.error)return normalError("Bulk 작업 조회에 실패했습니다.",500,"JOB_QUERY_FAILED","normal.result.job_query",jobResult.error);
 if(!jobResult.data)return normalError("작업을 찾을 수 없거나 접근 권한이 없습니다.",404,"JOB_NOT_FOUND","normal.result.job_query");
 if(!["normal_running","dispatch_uncertain"].includes(String(jobResult.data.status)))return normalError("현재 상태에서는 일반 청크 결과를 확인할 수 없습니다.",409,"INVALID_JOB_STATUS","normal.result.job_query");
 const chunkResult=await auth.admin!.from("shopling_price_bulk_chunks").select("chunk_index,goods_keys,goods_key_count,request_id,status").eq("job_id",jobId).eq("chunk_type","normal").in("status",["running","dispatch_uncertain"]).order("chunk_index",{ascending:true}).limit(2);
 if(chunkResult.error)return normalError("활성 일반 청크 조회에 실패했습니다.",500,"CHUNK_QUERY_FAILED","normal.result.chunk_query",chunkResult.error);
 const chunks=Array.isArray(chunkResult.data)?chunkResult.data:[];if(chunks.length!==1)return normalError("활성 일반 청크가 정확히 하나여야 합니다.",409,"ACTIVE_CHUNK_INVALID","normal.result.chunk_query");
 const chunk=chunks[0] as Record<string,unknown>;const requestId=typeof chunk.request_id==="string"?chunk.request_id:"";const keys=Array.isArray(chunk.goods_keys)?chunk.goods_keys.filter((v):v is string=>typeof v==="string"):[];
 if(!requestId||keys.length===0)return normalError("일반 청크 요청 정보가 불완전합니다.",409,"CHUNK_CONTEXT_INVALID","normal.result.chunk_query");
 const actions=await fetchShoplingPriceModifyActionsResult(requestId);
 if(actions.status==="pending")return NextResponse.json({status:"pending",request_id:requestId,message:"결과가 아직 준비되지 않았습니다."});
 if(actions.status==="error"||!actions.summary)return normalError(actions.message??"결과를 가져오지 못했습니다.",502,"ACTIONS_RESULT_FAILED","normal.result.actions_result");
 const analysis=analyzeShoplingPriceBulkNormalResult(actions.summary,requestId,keys,actions.runConclusion);
 const finished=await auth.admin!.rpc("finish_shopling_price_bulk_normal_chunk",{p_job_id:jobId,p_owner_id:auth.ownerId,p_request_id:requestId,p_success:analysis.success,p_failure_scope_known:analysis.failureScopeKnown,p_failed_keys:analysis.failedKeys,p_summary:actions.summary,p_run_url:actions.runUrl??null,p_error:analysis.success?null:analysis.message});
 if(finished.error)return normalError("일반 청크 결과 저장에 실패했습니다.",500,"FINISH_FAILED","normal.result.finish",finished.error);
 const state=rpcData(finished.data);return NextResponse.json({status:analysis.success?(state.status==="normal_succeeded"?"normal_succeeded":"chunk_succeeded"):"normal_failed",completed_chunk_index:chunk.chunk_index,completed_goods_key_count:keys.length,remaining_chunk_count:state.remaining_chunk_count,request_id:requestId,run_url:actions.runUrl,message:analysis.success?(state.status==="normal_succeeded"?"모든 상품의 가격설정 작업이 완료되었습니다.":"청크 성공을 확인했습니다."):analysis.message});
}
