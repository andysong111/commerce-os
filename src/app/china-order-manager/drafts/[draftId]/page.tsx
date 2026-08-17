import Link from "next/link";
import { InternalChinaDraftQuantityEditor } from "@/components/china-order-manager/InternalChinaDraftQuantityEditor";
import { InternalChinaDraftStickySave } from "@/components/china-order-manager/InternalChinaDraftStickySave";
import { InternalChinaPurchaseBudgetAudit } from "@/components/china-order-manager/InternalChinaPurchaseBudgetAudit";
import { InternalChinaManualDraftLineAdder } from "@/components/china-order-manager/InternalChinaManualDraftLineAdder";
import { InternalChinaPurchaseDraftWorkspaceV2 } from "@/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2";
import { PageHeader } from "@/components/PageHeader";
import { loadInternalChinaDraftWithQuantityOverrides } from "@/lib/internalChinaDraftQuantityOverride";
import { loadInternalChinaPurchaseBudgetAudit } from "@/lib/internalChinaPurchaseBudgetAudit";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

type PageProps = {
  params: Promise<{ draftId: string }>;
};

export default async function InternalChinaPurchaseDraftPage({
  params,
}: PageProps) {
  const { draftId: rawDraftId } = await params;
  const draftId = decodeURIComponent(rawDraftId);
  let draft;
  let budgetAudit;
  try {
    [draft, budgetAudit] = await Promise.all([
      loadInternalChinaPurchaseDraft(draftId),
      loadInternalChinaPurchaseBudgetAudit(draftId),
    ]);
    draft = await loadInternalChinaDraftWithQuantityOverrides(draft);
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
        description="기존 GPT Site의 주문 준비 단계를 대체하는 Ops Center 내부 화면입니다. 빠른 발주안의 RESERVED 수량을 기준으로 실제 주문 직전 검증을 끝내고, 예산 잔액이나 같은 모델의 추가 옵션은 현재 월간 Draft 한 건에 수동으로 더할 수 있습니다."
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
        <strong>현재 Draft</strong> · <span className="font-mono">{draft.draftId}</span> · {draft.lineCount.toLocaleString("ko-KR")} SKU · {draft.totalQuantity.toLocaleString("ko-KR")}개. 링크와 중국옵션은 아래 표에서 직접 입력하고 `발주초안 저장` 또는 우측의 `입력값 저장`으로 상품출시진행관리·상품마스터까지 양방향 반영합니다. 기존 B-code 수량은 `현재 Draft 수량 조정`, 새 B-code는 `주문품목 추가`에서 처리합니다.
      </section>

      <InternalChinaPurchaseBudgetAudit audit={budgetAudit} />

      <InternalChinaManualDraftLineAdder
        draftId={draft.draftId}
        status={draft.status}
      />

      <InternalChinaDraftQuantityEditor
        draftId={draft.draftId}
        status={draft.status}
        lines={draft.lines.map((line) => ({
          barcode: line.barcode,
          modelNo: line.modelNo,
          modelName: line.modelName,
          saleOption: line.saleOption,
          quantity: line.quantity,
        }))}
      />

      <InternalChinaPurchaseDraftWorkspaceV2
        initialDraft={draft}
        budgetAudit={budgetAudit}
      />

      <InternalChinaDraftStickySave status={draft.status} />
    </div>
  );
}
