import { DetailPageActiveJobControlsV2 } from "@/components/detail-page-ai-review/DetailPageActiveJobControlsV2";
import { DetailPageAiReviewWorkspace } from "@/components/detail-page-ai-review/DetailPageAiReviewWorkspace";
import { DetailPageCompilerCanaryControl } from "@/components/detail-page-ai-review/DetailPageCompilerCanaryControl";
import { DetailPageTerminalJobControls } from "@/components/detail-page-ai-review/DetailPageTerminalJobControls";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function DetailPageAiReviewPage() {
  return (
    <>
      <PageHeader
        title="상세페이지 AI 작업 검수"
        description="신규상품출시관리에서 생성한 상세페이지 작업을 한눈에 보고, AI가 지목한 문제 이미지와 1688 원본을 비교한 뒤 정상 자산은 보존한 채 문제 이미지만 재생성합니다."
      />
      <div className="mb-5 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
        <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-700">2.5초 자동 새로고침</span>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">정상 체크포인트 보존</span>
        <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700">전체 재생성은 확인 후 실행</span>
      </div>
      <DetailPageActiveJobControlsV2 />
      <DetailPageTerminalJobControls />
      <DetailPageCompilerCanaryControl />
      <DetailPageAiReviewWorkspace />
    </>
  );
}
