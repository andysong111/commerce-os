export const DEFAULT_TEMPORARY_OPS_OWNER_ID =
  "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36";
export const DEFAULT_TEMPORARY_OPS_OWNER_EMAIL = "andy0801a@gmail.com";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TemporaryOpsIdentity = {
  userId: string;
  email: string;
};

// Temporary operational switch. Set OPS_LOGIN_DISABLED=0 to restore the
// existing Supabase login flow without another code change.
export function isOpsLoginTemporarilyDisabled(
  env: NodeJS.ProcessEnv = process.env,
) {
  return env.OPS_LOGIN_DISABLED?.trim() !== "0";
}

export function temporaryOpsIdentity(
  env: NodeJS.ProcessEnv = process.env,
): TemporaryOpsIdentity {
  const configuredUserId = env.OPS_LOGIN_BYPASS_USER_ID?.trim() ?? "";
  const configuredEmail =
    env.OPS_LOGIN_BYPASS_EMAIL?.trim().toLowerCase() ?? "";

  return {
    userId: UUID_PATTERN.test(configuredUserId)
      ? configuredUserId
      : DEFAULT_TEMPORARY_OPS_OWNER_ID,
    email: configuredEmail || DEFAULT_TEMPORARY_OPS_OWNER_EMAIL,
  };
}

function safeOrigin(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function requestOrigin(request: Request) {
  const urlOrigin = safeOrigin(request.url);
  if (!urlOrigin) return null;

  const url = new URL(request.url);
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",", 1)[0]
    ?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim() || url.host;
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim();
  const protocol = forwardedProtocol || url.protocol.replace(/:$/, "");

  return safeOrigin(`${protocol}://${host}`) || urlOrigin;
}

// Login is temporarily bypassed, but browser APIs must still originate from
// this Ops Center. This keeps cross-site forms and casual direct API calls
// outside the operational UI from reaching write-capable routes.
export function isSameOriginOpsRequest(request: Request) {
  const expectedOrigin = requestOrigin(request);
  if (!expectedOrigin) return false;

  const origin = safeOrigin(request.headers.get("origin"));
  if (origin) return origin === expectedOrigin;

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") return false;

  const referer = safeOrigin(request.headers.get("referer"));
  if (referer) return referer === expectedOrigin;

  return fetchSite === "same-origin";
}
