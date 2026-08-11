"use client";

import { useMemo, useState } from "react";
import type {
  InternalChinaPurchaseDraft,
  InternalChinaPurchaseDraftLine,
} from "@/lib/internalChinaPurchaseDraft";

const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const cny = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function lineKey(line: InternalChinaPurchaseDraftLine) {
  return line.freightGroupId.trim() || `__${line.barcode}`;
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function InternalChinaPurchaseDraftWorkspace({
  initialDraft,
}: {
  initialDraft: InternalChinaPurchaseDraft;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [ordering, setOrdering] = useState(false);

  const calculations = useMemo(() => {
    const groups = new Map<string, { quantity: number; freight: number }>();
    for (const line of draft.lines) {
      const key = lineKey(line);
      const current = groups.get(key) ?? { quantity: 0, freight: 0 };
      current.quantity += line.quantity;
      current.freight += decimal(line.domesticChinaFreightCny);
      groups.set(key, current);
    }
    const byBarcode = new Map<
      string,
      {
        freightPerUnitCny: number;
        finalUnitCny: number;
        finalUnitKrw: number;
        totalCny: number;
        totalKrw: number;
      }
    >();
    let productCny = 0;
    let freightCny = 0;
    let totalCny = 0;
    let totalKrw = 0;
    for (const line of draft.lines) {
      const group = groups.get(lineKey(line)) ?? { quantity: 0, freight: 0 };
      const freightPerUnitCny =
        group.quantity > 0 ? group.freight / group.quantity : 0;
      const finalUnitCny = decimal(line.unitPriceCny) + freightPerUnitCny;
      const rowTotalCny = finalUnitCny * line.quantity;
      const finalUnitKrw = finalUnitCny * draft.exchangeRateKrwPerCny;
      const rowTotalKrw = rowTotalCny * draft.exchangeRateKrwPerCny;
      byBarcode.set(line.barcode, {
        freightPerUnitCny,
        finalUnitCny,
        finalUnitKrw,
        totalCny: rowTotalCny,
        totalKrw: rowTotalKrw,
      });
      productCny += decimal(line.unitPriceCny) * line.quantity;
      totalCny += rowTotalCny;
      totalKrw += rowTotalKrw;
    }
    freightCny = [...groups.values()].reduce(
      (sum, group) => sum + group.freight,
      0,
    );
    return { byBarcode, productCny, freightCny, totalCny, totalKrw };
  }, [draft]);

  const requiredIssues = useMemo(() => {
    const issues: string[] = [];
    for (const line of draft.lines) {
      if (line.unitPriceCny <= 0) issues.push(`${line.barcode} 위안단가`);
      if (!line.supplierLink) issues.push(`${line.barcode} 1688 링크`);
    }
    return issues;
  }, [draft.lines]);

  const optionalReviewCount = useMemo(
    () =>
      draft.lines.filter(
        (line) => !line.chinaOption.trim() || !line.saleOption.trim(),
      ).length,
    [draft.lines],
  );

  function updateLine(
    barcode: string,
    patch: Partial<InternalChinaPurchaseDraftLine>,
  ) {
    if (draft.status !== "DRAFT") return;
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.barcode === barcode ? { ...line, ...patch } : line,
      ),
    }));
  }

  function payload() {
    return {
      exchangeRateKrwPerCny: draft.exchangeRateKrwPerCny,
      lines: draft.lines.map((line) => ({
        barcode: line.barcode,
        quantity: line.quantity,
        saleOption: line.saleOption,
        chinaOption: line.chinaOption,
        supplierLink: line.supplierLink,
        unitPriceCny: line.unitPriceCny,
        freightGroupId: line.freightGroupId,
        domesticChinaFreightCny: line.domesticChinaFreightCny,
        orderNumber: line.orderNumber,
        note: line.note,
      })),
    };
  }

  async function saveDraft() {
    if (draft.status !== "DRAFT") return;
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload()),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        draft?: InternalChinaPurchaseDraft;
      };
      if (!response.ok || !body.ok || !body.draft) {
        setNotice(body.message || "중국 발주초안 저장에 실패했습니다.");
        return;
      }
      setDraft(body.draft);
      setNotice(body.message || "중국 발주초안을 저장했습니다.");
    } catch {
      setNotice("중국 발주초안 저장 요청이 일시적으로 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function markOrdered() {
    if (draft.status !== "DRAFT") return;
    setNotice("");
    if (requiredIssues.length) {
      setNotice(
        `실제 주문완료 기록 전에 필수값 ${requiredIssues.length}개를 채우세요. ${requiredIssues
          .slice(0, 6)
          .join(" · ")}`,
      );
      return;
    }
    if (
      !window.confirm(
        `실제로 1688에서 ${draft.lineCount}개 SKU · 총 ${draft.totalQuantity.toLocaleString("ko-KR")}개 주문을 완료했습니까?\n\n이 버튼은 1688 주문·결제를 실행하지 않습니다. 실제 주문이 끝난 뒤에만 Ops Center 원장을 ORDERED로 기록합니다.`,
      )
    ) {
      return;
    }
    setOrdering(true);
    try {
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draft.draftId)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ action: "MARK_ORDERED", prep: payload() }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        draft?: InternalChinaPurchaseDraft;
      };
      if (!response.ok || !body.ok || !body.draft) {
        setNotice(body.message || "실제 주문완료 기록에 실패했습니다.");
        return;
      }
      setDraft(body.draft);
      setNotice(body.message || "실제 주문완료로 원장에 기록했습니다.");
    } catch {
      setNotice(
        "실제 주문완료 기록 요청이 일시적으로 실패했습니다. 1688에서 실제 주문했는지 먼저 확인한 뒤 다시 시도하세요.",
      );
    } finally {
      setOrdering(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="상태" value={draft.status === "ORDERED" ? "실주문 기록" : "주문 준비"} />
        <Metric label="SKU" value={`${number.format(draft.lineCount)}개`} />
        <Metric label="총 주문수량" value={`${number.format(draft.totalQuantity)}개`} />
        <Metric label="필수 확인" value={`${number.format(requiredIssues.length)}건`} danger={requiredIssues.length > 0} />
        <Metric label="예상 지급액" value={`${number.format(Math.round(calculations.totalKrw))}원`} emphasized />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">
              OPS CENTER NATIVE · NO GPT SITE
            </span>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              실제 1688 주문 준비
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              B-code·판매옵션·중국옵션·1688 링크는 기존 Commerce OS 데이터를 재사용합니다. 노란 입력값인 위안단가와 실제 중국내 운임만 주문 화면에서 확인해 채우면 됩니다. 수량은 빠른 발주안에서 RESERVED로 확정된 값이므로 여기서는 변경하지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold text-slate-600">
              적용 환율 KRW/CNY
              <input
                type="number"
                min={1}
                max={10000}
                step="0.01"
                disabled={draft.status !== "DRAFT"}
                value={draft.exchangeRateKrwPerCny}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    exchangeRateKrwPerCny: decimal(event.target.value),
                  }))
                }
                className="mt-1 block w-32 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-right font-black outline-none focus:border-amber-500 disabled:bg-slate-100"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={saving || draft.status !== "DRAFT"}
              className="rounded-xl border border-blue-300 bg-white px-4 py-2.5 text-sm font-black text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "저장 중..." : "발주초안 저장"}
            </button>
            <button
              type="button"
              onClick={() => void markOrdered()}
              disabled={ordering || draft.status !== "DRAFT" || requiredIssues.length > 0}
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {draft.status === "ORDERED"
                ? "실주문 기록완료"
                : ordering
                  ? "기록 중..."
                  : "1688 주문완료 후 기록"}
            </button>
          </div>
        </div>

        {notice ? (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
            {notice}
          </div>
        ) : null}

        {draft.metadataWarnings.length ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
            {draft.metadataWarnings.slice(0, 4).join(" · ")}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SubMetric label="상품금액" value={`${cny.format(calculations.productCny)} CNY`} />
          <SubMetric label="중국내 운임" value={`${cny.format(calculations.freightCny)} CNY`} />
          <SubMetric label="합계" value={`${cny.format(calculations.totalCny)} CNY`} />
          <SubMetric label="옵션 확인 권장" value={`${number.format(optionalReviewCount)} SKU`} />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[2200px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-500">
              <tr>
                <th className="px-3 py-3">B-code / 모델</th>
                <th className="px-3 py-3">상품명</th>
                <th className="px-3 py-3">판매옵션</th>
                <th className="px-3 py-3">중국옵션</th>
                <th className="px-3 py-3">1688 기준 링크</th>
                <th className="px-3 py-3 text-right">수량</th>
                <th className="px-3 py-3 text-right">위안단가</th>
                <th className="px-3 py-3">운임그룹</th>
                <th className="px-3 py-3 text-right">중국내 운임</th>
                <th className="px-3 py-3 text-right">개당 운임</th>
                <th className="px-3 py-3 text-right">최종단가 CNY</th>
                <th className="px-3 py-3 text-right">최종단가 KRW</th>
                <th className="px-3 py-3">1688 주문번호</th>
                <th className="px-3 py-3">메모</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {draft.lines.map((line) => {
                const calc = calculations.byBarcode.get(line.barcode)!;
                const editable = draft.status === "DRAFT";
                return (
                  <tr key={line.barcode} className="align-top hover:bg-slate-50/70">
                    <td className="min-w-[250px] px-3 py-3">
                      <strong className="font-mono text-sm text-slate-950">{line.barcode}</strong>
                      <span className="mt-1 block font-semibold text-slate-700">{line.modelName || "모델명 -"}</span>
                      <span className="mt-1 block font-mono text-[11px] text-slate-400">{line.modelNo}</span>
                    </td>
                    <td className="max-w-[300px] px-3 py-3 font-semibold text-slate-800">{line.productName}</td>
                    <td className="px-2 py-2">
                      <Input value={line.saleOption} disabled={!editable} onChange={(value) => updateLine(line.barcode, { saleOption: value })} />
                    </td>
                    <td className="px-2 py-2">
                      <Input value={line.chinaOption} disabled={!editable} warning={!line.chinaOption.trim()} onChange={(value) => updateLine(line.barcode, { chinaOption: value })} />
                    </td>
                    <td className="min-w-[360px] px-2 py-2">
                      <div className="flex gap-2">
                        <Input value={line.supplierLink} disabled={!editable} required={!line.supplierLink} onChange={(value) => updateLine(line.barcode, { supplierLink: value })} />
                        {validHttpUrl(line.supplierLink) ? (
                          <a href={line.supplierLink} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-2 font-black text-emerald-800 hover:bg-emerald-100">1688 열기</a>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-sm font-black text-slate-950">{number.format(line.quantity)}</td>
                    <td className="px-2 py-2">
                      <NumberInput value={line.unitPriceCny} disabled={!editable} required={line.unitPriceCny <= 0} onChange={(value) => updateLine(line.barcode, { unitPriceCny: value })} />
                    </td>
                    <td className="px-2 py-2">
                      <Input value={line.freightGroupId} disabled={!editable} placeholder="같은 공급처면 동일 그룹" onChange={(value) => updateLine(line.barcode, { freightGroupId: value })} />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput value={line.domesticChinaFreightCny} disabled={!editable} onChange={(value) => updateLine(line.barcode, { domesticChinaFreightCny: value })} />
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-600">{cny.format(calc.freightPerUnitCny)}</td>
                    <td className="px-3 py-3 text-right font-black text-emerald-800">{cny.format(calc.finalUnitCny)}</td>
                    <td className="px-3 py-3 text-right font-black text-blue-800">{number.format(Math.round(calc.finalUnitKrw))}원</td>
                    <td className="px-2 py-2">
                      <Input value={line.orderNumber} disabled={!editable} placeholder="주문 후 입력 가능" onChange={(value) => updateLine(line.barcode, { orderNumber: value })} />
                    </td>
                    <td className="px-2 py-2">
                      <Input value={line.note} disabled={!editable} onChange={(value) => updateLine(line.barcode, { note: value })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-950">
        <strong>운영 규칙</strong> · `1688 주문완료 후 기록`은 외부 주문 버튼이 아닙니다. 실제 1688에서 주문·결제를 마친 뒤에만 눌러 Commerce OS의 RESERVED 약정을 ORDERED로 전환합니다. 위안단가와 1688 링크는 전 SKU 필수이며, 중국옵션·운임그룹은 실제 주문 화면과 다르면 반드시 수정하세요.
      </section>
    </div>
  );
}

function Input({
  value,
  onChange,
  disabled,
  placeholder = "",
  warning = false,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder?: string;
  warning?: boolean;
  required?: boolean;
}) {
  const flagged = warning || required;
  return (
    <input
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full min-w-[130px] rounded-lg border px-2.5 py-2 outline-none disabled:bg-slate-100 ${
        flagged
          ? "border-amber-300 bg-amber-50 focus:border-amber-500"
          : "border-slate-300 bg-white focus:border-slate-500"
      }`}
    />
  );
}

function NumberInput({
  value,
  onChange,
  disabled,
  required = false,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <input
      type="number"
      min={0}
      step="0.01"
      value={value || ""}
      disabled={disabled}
      onChange={(event) => onChange(decimal(event.target.value))}
      className={`w-28 rounded-lg border px-2.5 py-2 text-right font-black outline-none disabled:bg-slate-100 ${
        required
          ? "border-amber-300 bg-amber-50 focus:border-amber-500"
          : "border-slate-300 bg-white focus:border-slate-500"
      }`}
    />
  );
}

function Metric({
  label,
  value,
  emphasized = false,
  danger = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
  danger?: boolean;
}) {
  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm ${danger ? "border-amber-300" : emphasized ? "border-blue-300" : "border-slate-200"}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className={`mt-1 block text-xl ${danger ? "text-amber-700" : emphasized ? "text-blue-700" : "text-slate-950"}`}>{value}</strong>
    </article>
  );
}

function SubMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="text-xs text-slate-500">{label}</span>
      <strong className="mt-1 block text-base text-slate-950">{value}</strong>
    </div>
  );
}
