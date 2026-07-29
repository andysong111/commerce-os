export const OPS_AUTH_SESSION_DAYS = 180;
export const OPS_AUTH_COOKIE_MAX_AGE_SECONDS =
  OPS_AUTH_SESSION_DAYS * 24 * 60 * 60;

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
