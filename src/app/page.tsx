import { OpsDashboardWithSaasTestClone } from "@/components/dashboard/OpsDashboardWithSaasTestClone";
import { PageHeader } from "@/components/PageHeader";
import { isDetailPageCostAdmin } from "@/lib/detailPageCostAdmin";
import { opsModuleRegistry } from "@/lib/opsModuleRegistry";
import { getWorkspaceGroupById } from "@/lib/opsWorkspace";
import { getOpsCurrentUser } from "@/lib/supabase/currentUser";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string | string[] }>;
}) {
  const { user } = await getOpsCurrentUser();
  const showDetailPageCosts = isDetailPageCostAdmin(user?.email);
  const visibleModules = opsModuleRegistry.filter(
    (module) =>
      module.id !== "detail-page-cost-admin" || showDetailPageCosts,
  );
  const resolvedSearchParams = await searchParams;
  const rawGroup = Array.isArray(resolvedSearchParams.group)
    ? resolvedSearchParams.group[0]
    : resolvedSearchParams.group;
  const selectedGroupId = getWorkspaceGroupById(rawGroup)?.id ?? null;

  return (
    <>
      <PageHeader
        title="운영 대시보드"
        description="오늘 처리할 일과 핵심 업무 흐름을 먼저 확인하고, 기능명·모델번호·자연어 명령으로 필요한 도구를 바로 여세요."
      />
      <OpsDashboardWithSaasTestClone
        modules={visibleModules}
        selectedGroupId={selectedGroupId}
      />
    </>
  );
}
