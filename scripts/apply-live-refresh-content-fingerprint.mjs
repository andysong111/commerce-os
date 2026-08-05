import { readFile, writeFile } from "node:fs/promises";

const path = "src/lib/productDecisionLiveRefresh.ts";
let source = await readFile(path, "utf8");

function replaceOnce(from, to, label) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) {
    throw new Error(`PATCH_TARGET_INVALID:${label}`);
  }
  source = source.replace(from, to);
}

replaceOnce(
  `  planningGeneratedAt: string;\n  planningProductCount: number;`,
  `  planningGeneratedAt: string;\n  planningContentFingerprint: string;\n  planningProductCount: number;`,
  "request fingerprint field",
);

replaceOnce(
  `type PlanningPayload = {\n  ok?: boolean;\n  generatedAt?: string;\n  productCount?: number;`,
  `type PlanningPayload = {\n  ok?: boolean;\n  generatedAt?: string;\n  contentFingerprint?: string;\n  productCount?: number;`,
  "planning payload fingerprint",
);

replaceOnce(
  `type FailureSnapshot = {`,
  `type VersionedProductPlanningSnapshot = ProductPlanningSnapshot & {\n  contentFingerprint: string;\n};\n\ntype FailureSnapshot = {`,
  "versioned planning type",
);

replaceOnce(
  `export async function loadProductPlanningSnapshot(): Promise<ProductPlanningSnapshot> {`,
  `export async function loadProductPlanningSnapshot(): Promise<VersionedProductPlanningSnapshot> {`,
  "planning return type",
);

replaceOnce(
  `  const generatedAt = iso(payload.generatedAt);\n  if (!generatedAt) throw new Error("PRODUCT_MASTER_PLANNING_TIME_INVALID");\n  if (!payload.products.length) {\n    throw new Error("PRODUCT_MASTER_PLANNING_PRODUCTS_EMPTY");\n  }\n  return { generatedAt, products: payload.products };`,
  `  const generatedAt = iso(payload.generatedAt);\n  if (!generatedAt) throw new Error("PRODUCT_MASTER_PLANNING_TIME_INVALID");\n  const contentFingerprint = text(payload.contentFingerprint);\n  if (!/^sha256:[a-f0-9]{64}$/.test(contentFingerprint)) {\n    throw new Error("PRODUCT_MASTER_PLANNING_FINGERPRINT_INVALID");\n  }\n  if (!payload.products.length) {\n    throw new Error("PRODUCT_MASTER_PLANNING_PRODUCTS_EMPTY");\n  }\n  return { generatedAt, contentFingerprint, products: payload.products };`,
  "planning payload validation",
);

replaceOnce(
  `  const planningGeneratedAt = iso(value.planningGeneratedAt);\n  const orderRanges = Array.isArray(value.orderRanges)`,
  `  const planningGeneratedAt = iso(value.planningGeneratedAt);\n  const planningContentFingerprint = text(value.planningContentFingerprint);\n  const orderRanges = Array.isArray(value.orderRanges)`,
  "request parser fingerprint",
);

replaceOnce(
  `    !analysisAsOf ||\n    !planningGeneratedAt ||\n    !orderRanges.length ||`,
  `    !analysisAsOf ||\n    !planningGeneratedAt ||\n    !/^sha256:[a-f0-9]{64}$/.test(planningContentFingerprint) ||\n    !orderRanges.length ||`,
  "request fingerprint validation",
);

replaceOnce(
  `    planningGeneratedAt,\n    planningProductCount: integer(value.planningProductCount),`,
  `    planningGeneratedAt,\n    planningContentFingerprint,\n    planningProductCount: integer(value.planningProductCount),`,
  "request parser output",
);

replaceOnce(
  `  planning: ProductPlanningSnapshot,\n  analysisAsOf = new Date().toISOString(),`,
  `  planning: VersionedProductPlanningSnapshot,\n  analysisAsOf = new Date().toISOString(),`,
  "request plan input type",
);

replaceOnce(
  `    planningGeneratedAt: planning.generatedAt,\n    planningProductCount: planning.products.length,`,
  `    planningGeneratedAt: planning.generatedAt,\n    planningContentFingerprint: planning.contentFingerprint,\n    planningProductCount: planning.products.length,`,
  "request plan fingerprint",
);

replaceOnce(
  `async function verifiedPlanning(request: ProductDecisionLiveRequest) {\n  const planning = await loadProductPlanningSnapshot();\n  if (planning.generatedAt !== request.planningGeneratedAt) {\n    throw new Error(\n      \`PRODUCT_MASTER_PLANNING_CHANGED:\${request.planningGeneratedAt}:\${planning.generatedAt}\`,\n    );\n  }`,
  `async function verifiedPlanning(request: ProductDecisionLiveRequest) {\n  const planning = await loadProductPlanningSnapshot();\n  if (planning.contentFingerprint !== request.planningContentFingerprint) {\n    throw new Error(\n      \`PRODUCT_MASTER_PLANNING_CHANGED:\${request.planningContentFingerprint}:\${planning.contentFingerprint}\`,\n    );\n  }`,
  "verified planning fingerprint",
);

const inputMarker = `      planningGeneratedAt: request.planningGeneratedAt,`;
const occurrences = source.split(inputMarker).length - 1;
if (occurrences !== 2) {
  throw new Error(`PATCH_TARGET_INVALID:chunk fingerprint markers:${occurrences}`);
}
source = source.replaceAll(
  inputMarker,
  `${inputMarker}\n      planningContentFingerprint: request.planningContentFingerprint,`,
);

await writeFile(path, source);
