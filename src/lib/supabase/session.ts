export const OPS_AUTH_SESSION_DAYS = 180;
export const OPS_AUTH_COOKIE_MAX_AGE_SECONDS =
  OPS_AUTH_SESSION_DAYS * 24 * 60 * 60;
export const OPS_AUTH_DEFAULT_REDIRECT = "/sourcing-engine/settings";

export function getOpsAuthCookieOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV,
) {
  return {
    maxAge: OPS_AUTH_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: nodeEnv === "production",
  };
}

export function getSafeOpsAuthRedirect(
  value: string | null | undefined,
  fallback = OPS_AUTH_DEFAULT_REDIRECT,
) {
  const candidate = value?.trim() ?? "";
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return fallback;
  }

  try {
    const base = new URL("https://ops.local");
    const parsed = new URL(candidate, base);
    if (
      parsed.origin !== base.origin ||
      ["/login", "/logout", "/auth/callback"].includes(parsed.pathname)
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
