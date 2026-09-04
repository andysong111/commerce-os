from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        if new in text:
            return
        raise SystemExit(f"target not found: {path}\n{old[:180]}")
    p.write_text(text.replace(old, new, 1))


summary = "src/lib/internalChinaMonthlyPurchaseSummary.ts"
replace_once(
    summary,
    "  modelName: string;\n  chinaOption: string;\n  orderNumber: string;\n  quantity: number;",
    "  modelName: string;\n  saleOption: string;\n  chinaOption: string;\n  orderNumber: string;\n  supplierLink: string;\n  quantity: number;",
)
replace_once(
    summary,
    "    modelName,\n    chinaOption: text(row.chinaOption),\n    orderNumber,\n    quantity,",
    "    modelName,\n    saleOption: text(row.saleOption),\n    chinaOption: text(row.chinaOption),\n    orderNumber,\n    supplierLink: text(row.supplierLink),\n    quantity,",
)

parser = "src/lib/freightApplicationParser.ts"
replace_once(
    parser,
    'import { findProductsByText } from "./productMaster.ts";\n',
    'import { findProductsByText } from "./productMaster.ts";\nimport { applyActiveFreightMonthlyOrderContext } from "./freightMonthlyOrderContext.ts";\n',
)
replace_once(
    parser,
    "function enrichItemsFromProductMaster(\n  items: FreightApplicationItem[],\n): FreightApplicationItem[] {\n  return items.map(enrichItemFromProductMaster);\n}",
    "function enrichItemsFromProductMaster(\n  items: FreightApplicationItem[],\n): FreightApplicationItem[] {\n  const productMasterItems = items.map(enrichItemFromProductMaster);\n  return applyActiveFreightMonthlyOrderContext(productMasterItems);\n}",
)

page = "src/app/china-order-manager/page.tsx"
replace_once(
    page,
    'description="월 하나를 선택해 예산 → 1688 주문 → 입고 → 실제 원가 → 자금 마감 순서로 처리합니다. 지금 입력해야 할 영역만 기본 화면에 두고, 원가 상세·월별 이력·원장은 접어서 보관합니다."',
    'description="월 하나를 선택해 예산 → 1688 주문 → 배송대행지 바코드 출력 → 입고 → 실제 원가 → 자금 마감 순서로 처리합니다. 바코드 단계에서는 해당 월 실제 주문정보를 온돌패스 신청서와 자동 연결합니다."',
)
old_flow = '''            <FlowStep
              number="3"
              title="입고"
              state={openQuantity ? "active" : receiptDone ? "done" : "wait"}
              detail={
                openQuantity
                  ? `남은 미입고 ${money.format(openQuantity)}개`
                  : receiptDone
                    ? "추적 품목 입고 완료"
                    : "실주문 후 진행"
              }
            />
            <FlowStep
              number="4"
              title="배송대행 실제비용·원가"
              state={forwarderDone ? "done" : receiptDone ? "active" : "wait"}
              detail={
                forwarderDone
                  ? `실제 부대비용 ${money.format(forwarderCostKrw)}원`
                  : receiptDone
                    ? "최종 청구액 직접 입력"
                    : "전량 입고 후 진행"
              }
            />
            <FlowStep
              number="5"
              title="월 자금 마감"
              state={fundingDone ? "done" : forwarderDone ? "active" : "wait"}
              detail={
                fundingDone
                  ? "WorldFirst·한국계좌 마감 완료"
                  : "실제 원가 마감 후 진행"
              }
            />'''
new_flow = '''            <FlowStep
              number="3"
              title="배송대행지 바코드 출력"
              state={receiptDone ? "done" : hasOrder ? "active" : "wait"}
              detail={
                receiptDone
                  ? "입고 단계 통과 · 필요 시 월 주문정보로 다시 출력 가능"
                  : hasOrder
                    ? `${money.format(purchase?.assignedLineCount ?? selectedRows.length)}개 주문 품목 전달 · 온돌패스 주문번호로 B-code 자동연결`
                    : "실주문 후 진행"
              }
              href={
                hasOrder
                  ? `/freight-barcode-request/monthly?month=${encodeURIComponent(selectedMonth)}`
                  : undefined
              }
              actionLabel="바코드 출력으로 이동"
            />
            <FlowStep
              number="4"
              title="입고"
              state={openQuantity ? "active" : receiptDone ? "done" : "wait"}
              detail={
                openQuantity
                  ? `남은 미입고 ${money.format(openQuantity)}개`
                  : receiptDone
                    ? "추적 품목 입고 완료"
                    : "실주문 후 진행"
              }
            />
            <FlowStep
              number="5"
              title="배송대행 실제비용·원가"
              state={forwarderDone ? "done" : receiptDone ? "active" : "wait"}
              detail={
                forwarderDone
                  ? `실제 부대비용 ${money.format(forwarderCostKrw)}원`
                  : receiptDone
                    ? "최종 청구액 직접 입력"
                    : "전량 입고 후 진행"
              }
            />
            <FlowStep
              number="6"
              title="월 자금 마감"
              state={fundingDone ? "done" : forwarderDone ? "active" : "wait"}
              detail={
                fundingDone
                  ? "WorldFirst·한국계좌 마감 완료"
                  : "실제 원가 마감 후 진행"
              }
            />'''
replace_once(page, old_flow, new_flow)
replace_once(
    page,
    "            발주 마감은 추가 구매만 차단합니다. 이미 주문한 품목의 입고·실제 원가·자금 마감은 계속 진행됩니다.",
    "            발주 마감 후 배송대행지 바코드 출력에서 해당 월 주문번호·B-code를 온돌패스 신청서와 연결합니다. 이후 입고·실제 원가·자금 마감을 계속 진행합니다.",
)
old_sig = '''function FlowStep({
  number,
  title,
  state,
  detail,
}: {
  number: string;
  title: string;
  state: "done" | "active" | "wait";
  detail: string;
}) {'''
new_sig = '''function FlowStep({
  number,
  title,
  state,
  detail,
  href,
  actionLabel,
}: {
  number: string;
  title: string;
  state: "done" | "active" | "wait";
  detail: string;
  href?: string;
  actionLabel?: string;
}) {'''
replace_once(page, old_sig, new_sig)
old_body = '''      <div>
        <strong className="text-sm text-white">{title}</strong>
        <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
      </div>'''
new_body = '''      <div className="min-w-0 flex-1">
        <strong className="text-sm text-white">{title}</strong>
        <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
        {href && actionLabel ? (
          <Link
            href={href}
            className="mt-2 inline-flex rounded-lg border border-cyan-500/60 bg-cyan-400/10 px-3 py-1.5 text-xs font-black text-cyan-200 hover:bg-cyan-400/20"
          >
            {actionLabel} →
          </Link>
        ) : null}
      </div>'''
replace_once(page, old_body, new_body)
