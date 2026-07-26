export function normalErrorDetail(detail: unknown): string | null {
  if (detail == null) return null;
  let text: string;
  if (detail instanceof Error) text = detail.message;
  else if (typeof detail === "string") text = detail;
  else if (typeof detail === "object" && "message" in detail && typeof detail.message === "string") text = detail.message;
  else {
    try { text = JSON.stringify(detail); }
    catch { text = String(detail); }
  }
  return text
    .replace(/sb_secret_[A-Za-z0-9._-]+/gi, "[REDACTED_SUPABASE_SECRET]")
    .replace(/\bBearer\s+[^\s,;"'}]+/gi, "Bearer [REDACTED]")
    .replace(/(["']?(?:apikey|authorization|service[_ -]?role(?:[_ -]?key)?|SUPABASE_SERVICE_ROLE_KEY)["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi, "$1[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .slice(0, 1000);
}
