import type { ReactNode } from "react";

export default function ReliabilityLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
        <strong className="text-slate-800">개인정보 최소화:</strong>{" "}
        원문 입력·고객 이메일·이미지는 저장하지 않음. 운영 상태·오류 코드·재시도·품질 수치처럼 개선에 필요한 최소 신호만 사용합니다.
      </div>
      {children}
    </div>
  );
}
