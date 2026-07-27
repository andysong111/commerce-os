import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ShoplingPriceModifyRunner } from "@/components/shopling-price-modify-runner/ShoplingPriceModifyRunner";
import { ShoplingPriceModifyBulkInputPreview } from "@/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview";
import { ShoplingPriceModifyBulkOperations } from "@/components/shopling-price-modify-runner/ShoplingPriceModifyBulkOperations";

export default function ShoplingPriceModifyAdvancedPage() {
  return <>
    <PageHeader
      title="샵플링 가격설정 고급 관리"
      description="수동 시험 실행, 실패 복구, 작업 기록, 성능 검사 등 기술 관리 기능입니다."
    />
    <div className="mb-5">
      <Link href="/shopling-price-modify-runner" className="inline-flex rounded-lg border bg-white px-4 py-2 text-sm font-bold text-blue-700 shadow-sm">
        ← 쉬운 자동 실행 화면으로 돌아가기
      </Link>
    </div>
    <div className="space-y-8">
      <ShoplingPriceModifyBulkInputPreview />
      <ShoplingPriceModifyBulkOperations />
      <details className="rounded-2xl border bg-white p-6">
        <summary className="cursor-pointer text-xl font-bold">50개 이하 직접 실행</summary>
        <p className="my-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          기존 50개 이하 즉시 실행 기능입니다.<br />수천 개 자동 실행은 쉬운 자동 실행 화면을 사용하세요.
        </p>
        <ShoplingPriceModifyRunner />
      </details>
    </div>
  </>;
}
