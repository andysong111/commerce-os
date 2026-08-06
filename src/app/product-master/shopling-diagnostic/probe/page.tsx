import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadLatestProductMasterShoplingProbe } from "@/lib/productMasterShoplingProbe";
import { ProbeControl } from "./ProbeControl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductMasterShoplingProbePage() {
  const initialResult = await loadLatestProductMasterShoplingProbe().catch(
    () => null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 상품마스터 Shopling 연결 진단"
        title="Shopling 상품 API 최소 범위 진단"
        description="전수진단이 첫 구간에서 실패할 때 하루 범위 읽기만 실행해 날짜범위와 네트워크·보안연결·Shopling 응답 문제를 분리합니다."
        actions={
          <Link
            href="/product-master/shopling-diagnostic"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            전수진단으로 돌아가기
          </Link>
        }
      />

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <strong className="block text-base">진단 전용 · 운영 데이터 미변경</strong>
        <p className="mt-2 leading-6">
          상품 API의 하루 범위 응답 여부와 안전한 오류분류만 저장합니다. 원본 응답행,
          로그인정보, API 인증키는 화면이나 실행원장에 저장하지 않습니다.
        </p>
      </section>

      <ProbeControl initialResult={initialResult} />
    </div>
  );
}
