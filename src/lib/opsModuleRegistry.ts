import { detailPageSaasTest260807Module } from "@/lib/detailPageSaasTest260807Module";
import { detailPageSaasTestModule } from "@/lib/detailPageSaasTestModule";
import { extendedModuleRegistry } from "@/lib/extendedModuleRegistry";
import type { CommerceModule } from "@/lib/moduleRegistry";

export const opsModuleRegistry: readonly CommerceModule[] = [
  ...extendedModuleRegistry,
  detailPageSaasTestModule,
  detailPageSaasTest260807Module,
];
