import type { ReactNode } from "react";

type KeywordElonCollapsibleSectionProps = {
  title: string;
  description: string;
  badge?: string;
  children: ReactNode;
};

export default function KeywordElonCollapsibleSection({
  title,
  description,
  badge = "기본 숨김",
  children,
}: KeywordElonCollapsibleSectionProps) {
  return (
    <details className="group mx-auto mt-4 max-w-[1500px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-black text-slate-900">{title}</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">{badge}</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <span className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
          <span className="group-open:hidden">펼쳐보기</span>
          <span className="hidden group-open:inline">숨기기</span>
        </span>
      </summary>
      <div className="border-t border-slate-200 bg-slate-50/40 pb-6">{children}</div>
    </details>
  );
}
