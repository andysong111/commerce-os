import { detailPageTestStudioModule } from "@/lib/detailPageTestStudioModule";
import { extendedModuleRegistry } from "@/lib/extendedModuleRegistry";

export const opsModuleRegistry = [
  ...extendedModuleRegistry,
  detailPageTestStudioModule,
] as const;
