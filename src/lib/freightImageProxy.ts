export const FREIGHT_IMAGE_PROXY_PATH = "/api/freight-image-proxy";

const ALLOWED_HOST_SUFFIXES = ["alicdn.com", "1688.com"] as const;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function isAllowedFreightImageHost(hostnameInput: unknown) {
  const hostname = text(hostnameInput).toLowerCase().replace(/\.$/, "");
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

export function normalizeFreightImageUpstreamUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return null;

  const absolute = candidate.startsWith("//") ? `https:${candidate}` : candidate;
  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (!isAllowedFreightImageHost(url.hostname)) return null;
  if (url.username || url.password) return null;
  if (url.port && !["80", "443"].includes(url.port)) return null;

  // Avoid mixed-content failures and keep the proxy cache key stable.
  url.protocol = "https:";
  url.port = "";
  url.hash = "";
  return url.toString();
}

export function readFreightImageProxyUpstreamUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate, "https://commerce-os.local");
    if (parsed.pathname !== FREIGHT_IMAGE_PROXY_PATH) return null;
    return normalizeFreightImageUpstreamUrl(parsed.searchParams.get("url"));
  } catch {
    return null;
  }
}

export function toFreightImageProxyUrl(value: unknown) {
  const existingUpstream = readFreightImageProxyUpstreamUrl(value);
  if (existingUpstream) {
    return `${FREIGHT_IMAGE_PROXY_PATH}?url=${encodeURIComponent(existingUpstream)}`;
  }

  const upstream = normalizeFreightImageUpstreamUrl(value);
  return upstream
    ? `${FREIGHT_IMAGE_PROXY_PATH}?url=${encodeURIComponent(upstream)}`
    : null;
}

export function buildFreightImageSourceChain(value: unknown) {
  const candidate = text(value);
  if (!candidate) return [];

  const existingUpstream = readFreightImageProxyUpstreamUrl(candidate);
  if (existingUpstream) {
    return [...new Set([candidate, existingUpstream])];
  }

  const upstream = normalizeFreightImageUpstreamUrl(candidate);
  if (!upstream) return [candidate];
  return [
    `${FREIGHT_IMAGE_PROXY_PATH}?url=${encodeURIComponent(upstream)}`,
    upstream,
  ];
}
