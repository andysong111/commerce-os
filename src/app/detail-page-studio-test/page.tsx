import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { TestStudioBridge } from "./TestStudioBridge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_TEST_STUDIO_URL =
  "https://new-product-detail-ai-a2bsangsa.vercel.app/";

export default function DetailPageStudioTestPage() {
  const studioBaseUrl =
    process.env.NEXT_PUBLIC_DETAIL_PAGE_STUDIO_TEST_URL?.trim() ||
    DEFAULT_TEST_STUDIO_URL;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="COMMERCE OS · TEST ENGINE"
        title="상세페이지 스튜디오 테스트버전"
        description="1688 링크 또는 이미지 3장을 직접 입력해 새 상세페이지 엔진용 작업을 등록합니다. 등록된 입력은 기존 상세페이지 AI 작업 검수 원장에서 같은 작업 ID로 추적됩니다."
        actions={
          <Link
            href="/detail-page-ai-review"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            상세페이지 AI 작업 검수
          </Link>
        }
      />

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong className="block">테스트버전 · 기존 운영 엔진과 분리</strong>
        <p className="mt-2 leading-6">
          입력과 원본 이미지만 기존 작업 원장에 저장합니다. 전용 테스트 엔진이
          연결되기 전에는 기존 운영 상세페이지 Worker가 이 작업을 가져가지
          않습니다.
        </p>
      </section>

      <TestStudioBridge studioBaseUrl={studioBaseUrl} />
    </div>
  );
}
