import Link from "next/link";
import { InternalChinaPurchaseBudgetAudit } from "@/components/china-order-manager/InternalChinaPurchaseBudgetAudit";
import { InternalChinaPurchaseDraftWorkspace } from "@/components/china-order-manager/InternalChinaPurchaseDraftWorkspace";
import { PageHeader } from "@/components/PageHeader";
import { loadInternalChinaPurchaseBudgetAudit } from "@/lib/internalChinaPurchaseBudgetAudit";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

type PageProps = {
  params: Promise<{ draftId: string }>;
};

export default async function InternalChinaPurchaseDraftPage({ params }: PageProps) {
  const { draftId: rawDraftId } = await params;
  const draftId = decodeURIComponent(rawDraftId);
  let draft;
  let budgetAudit;
  try {
    [draft, budgetAudit] = await Promise.all([
      loadInternalChinaPurchaseDraft(draftId),
      loadInternalChinaPurchaseBudgetAudit(draftId),
    ]);
  } catch (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="COMMERCE OS · 중국 발주·입고 내부 이전"
          title="중국 주문초안을 열지 못했습니다"
          description="Ops Center 내부 RESERVED Draft를 다시 확인한 뒤 열어주세요. GPT Site로 우회하지 않습니다."
          actions={
            <Link
              href="/fast-purchase-mvp"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              빠른 발주안으로 돌아가기
            </Link>
          }
        />
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
          {error instanceof Error ? error.message : "INTERNAL_CHINA_DRAFT_FAILED"}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · OPS CENTER NATIVE CHINA ORDER MVP"
        title="중국 발주초안"
        description="빠른 발주안의 RESERVED 수량을 그대로 사용하고, 상품출시진행관리·Product Master·Shopling의 B-code 정보를 재사용해 1688 주문 직전 검증을 Ops Center 안에서 끝냅니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/fast-purchase-mvp"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              빠른 발주안
            </Link>
            <Link
              href="/china-order-manager"
              className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800"
            >
              발주·입고 원장
            </Link>
          </div>
        }
      />

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
        <strong>현재 Draft</strong> · <span className="font-mono">{draft.draftId}</span> · {draft.lineCount.toLocaleString("ko-KR")} SKU · {draft.totalQuantity.toLocaleString("ko-KR")}개. 이 화면은 기존 GPT Site의 주문 준비 단계를 대체하는 Ops Center 내부 MVP입니다.
      </section>

      <InternalChinaPurchaseBudgetAudit audit={budgetAudit} />

      <InternalChinaPurchaseDraftWorkspace initialDraft={draft} />
    </div>
  );
}
