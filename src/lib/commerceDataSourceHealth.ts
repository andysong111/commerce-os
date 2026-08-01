export type CommerceDataSourceStatus =
  | "FRESH"
  | "STALE"
  | "MISSING"
  | "FAILED";

export async function recordCommerceDataSourceHealth(input: {
  sourceKey: string;
  status: CommerceDataSourceStatus;
  generatedAt: string | null;
  maxAgeMinutes: number;
  details?: Record<string, unknown>;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) {
    throw new Error("OPS_CONTROL_SUPABASE_CONFIGURATION_REQUIRED");
  }
  if (!input.sourceKey.trim() || input.maxAgeMinutes <= 0) {
    throw new Error("INVALID_COMMERCE_DATA_SOURCE_HEALTH");
  }

  const headers: Record<string, string> = {
    apikey: secret,
    accept: "application/json",
    "content-type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  };
  if (!secret.startsWith("sb_secret_")) {
    headers.authorization = `Bearer ${secret}`;
  }

  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_data_source_health?on_conflict=source_key`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        source_key: input.sourceKey.trim(),
        status: input.status,
        generated_at: input.generatedAt,
        received_at: new Date().toISOString(),
        max_age_minutes: Math.max(1, Math.round(input.maxAgeMinutes)),
        details: input.details ?? {},
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(
      `COMMERCE_DATA_SOURCE_HEALTH_SAVE_FAILED:${response.status}:${(
        await response.text()
      ).slice(0, 500)}`,
    );
  }
}
