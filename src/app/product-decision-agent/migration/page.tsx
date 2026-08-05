import { PageHeader } from "@/components/PageHeader";
import { ProductDecisionSnapshotImporter } from "./ProductDecisionSnapshotImporter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ProductDecisionMigrationPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 발주 추천 내부 이전"
        title="검증 D1 백업 복원"
        description="기존 ChatGPT Site에서 생성한 읽기 전용 D1 백업을 검증하고, 최신 발주 계산 결과만 Ops Center 운영 원장에 불변 스냅샷으로 저장합니다."
      />
      <ProductDecisionSnapshotImporter />
    </div>
  );
}
