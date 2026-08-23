export type ReliabilityAutoImprovementSurface = {
  id: string;
  repository: string;
  allowedPaths: readonly string[];
  validationWorkflow: string;
  maxFiles: number;
  maxChangedCharacters: number;
  userDescription: string;
};

const SURFACES: ReliabilityAutoImprovementSurface[] = [
  {
    id: "ai_saurus_server_finalization_retry_v1",
    repository: "andysong111/commerce-os-detail-page-saas",
    allowedPaths: [
      "src/app/api/saas/jobs/[jobId]/finalize/route.ts",
      "src/lib/saasServerFinalizer.ts",
      "src/lib/saasServerFinalizerRetry.test.ts",
    ],
    validationWorkflow: "reliability-auto-improvement-validate.yml",
    maxFiles: 3,
    maxChangedCharacters: 45_000,
    userDescription: "AI-Saurus 최종 저장 단계의 일시적 실패를 안전하게 다시 시도하는 범위",
  },
];

const FORBIDDEN_PATH_PARTS = [
  ".github/",
  "supabase/migrations/",
  "vercel.json",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "/auth/",
  "auth/",
  "billing",
  "payment",
  "refund",
  "paddle",
  "lemon",
  "credit",
  "secret",
  "permission",
  "inventory",
  "price-adjust",
  "priceadjust",
  "order-write",
];

export function getReliabilityAutoImprovementSurface(
  id: string | null | undefined,
): ReliabilityAutoImprovementSurface | null {
  const normalized = String(id ?? "").trim();
  return SURFACES.find((surface) => surface.id === normalized) ?? null;
}

export function isReliabilityAutoImprovementPathForbidden(path: string) {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return FORBIDDEN_PATH_PARTS.some((part) => normalized.includes(part));
}

export function validateReliabilityAutoImprovementPaths(input: {
  surface: ReliabilityAutoImprovementSurface;
  paths: string[];
}) {
  const unique = [...new Set(input.paths.map((path) => String(path).trim()))];
  if (!unique.length) throw new Error("자동수정 파일이 비어 있습니다.");
  if (unique.length > input.surface.maxFiles) {
    throw new Error("자동수정 파일 수가 안전 한도를 넘었습니다.");
  }
  const allowed = new Set(input.surface.allowedPaths);
  for (const path of unique) {
    if (!allowed.has(path)) {
      throw new Error(`자동수정 허용 범위 밖의 파일입니다: ${path}`);
    }
    if (isReliabilityAutoImprovementPathForbidden(path)) {
      throw new Error(`위험한 파일 경로는 자동수정할 수 없습니다: ${path}`);
    }
  }
  return unique;
}

export function reliabilityAutoImprovementSafetySummary() {
  return {
    automaticSurfaces: SURFACES.map((surface) => ({
      id: surface.id,
      repository: surface.repository,
      userDescription: surface.userDescription,
    })),
    principle:
      "등록된 저위험 파일만 자동수정하며 가격·재고·주문·결제·권한·DB·배포설정은 자동으로 변경하지 않습니다.",
  };
}
