export type SeoShoplingLiveReadiness = {
  ready: boolean;
  configured: string[];
  missing: string[];
};

const REQUIRED = [
  "SHOPLING_UPLOAD_REPO",
  "GITHUB_ACTIONS_TOKEN",
  "PRODUCT_LAUNCH_UPLOAD_SECRET",
  "KEYWORD_SHOPLING_APPLY_REPO",
  "KEYWORD_SHOPLING_APPLY_ACTIONS_TOKEN",
  "CRON_SECRET",
] as const;

export function getSeoShoplingLiveReadiness(): SeoShoplingLiveReadiness {
  const configured: string[] = [];
  const missing: string[] = [];
  for (const name of REQUIRED) {
    if (process.env[name]?.trim()) configured.push(name);
    else missing.push(name);
  }
  if (process.env.KEYWORD_SHOPLING_APPLY_ENABLED?.trim() === "1") {
    configured.push("KEYWORD_SHOPLING_APPLY_ENABLED=1");
  } else {
    missing.push("KEYWORD_SHOPLING_APPLY_ENABLED=1");
  }
  return { ready: missing.length === 0, configured, missing };
}

export function assertSeoShoplingLiveReady() {
  const readiness = getSeoShoplingLiveReadiness();
  if (!readiness.ready) {
    throw new Error(
      `샵플링 SEO 실제등록 연결이 아직 준비되지 않았습니다. 미설정: ${readiness.missing.join(", ")}`,
    );
  }
  return readiness;
}
