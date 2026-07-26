type AdminResult = { data: unknown; error: { message: string } | null };
type OrderOptions = { ascending?: boolean };

class SupabaseRestQuery implements PromiseLike<AdminResult> {
  private readonly params = new URLSearchParams();

  constructor(
    private readonly baseUrl: string,
    private readonly secretKey: string,
    private readonly table: string,
  ) {}

  select(columns = "*") {
    this.params.set("select", columns);
    return this;
  }

  eq(column: string, value: unknown) {
    this.params.append(column, `eq.${String(value)}`);
    return this;
  }

  order(column: string, options: OrderOptions = {}) {
    this.params.set("order", `${column}.${options.ascending === false ? "desc" : "asc"}`);
    return this;
  }

  limit(count: number) {
    this.params.set("limit", String(count));
    return this;
  }

  async maybeSingle(): Promise<AdminResult> {
    this.params.set("limit", "1");
    const result = await this.execute();
    if (result.error) return result;
    const rows = Array.isArray(result.data) ? result.data : [];
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = AdminResult, TResult2 = never>(
    onfulfilled?: ((value: AdminResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<AdminResult> {
    const response = await fetch(`${this.baseUrl}/rest/v1/${encodeURIComponent(this.table)}?${this.params.toString()}`, {
      method: "GET",
      headers: createSupabaseAdminHeaders(this.secretKey),
      cache: "no-store",
    });
    return readAdminResponse(response);
  }
}

export async function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const supabaseSecretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();

  if (!supabaseUrl || !supabaseSecretKey) return null;

  return {
    rpc: async (name: string, parameters: Record<string, unknown>): Promise<AdminResult> => {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: createSupabaseAdminHeaders(supabaseSecretKey),
        body: JSON.stringify(parameters),
        cache: "no-store",
      });
      return readAdminResponse(response);
    },
    from: (table: string) => new SupabaseRestQuery(supabaseUrl, supabaseSecretKey, table),
  };
}

export function createSupabaseAdminHeaders(secretKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: secretKey,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // New sb_secret_ keys are opaque API keys, not JWTs. Sending them as
  // Authorization: Bearer makes PostgREST reject the request as Invalid JWT.
  // Legacy service_role keys are JWTs and still require the bearer header.
  if (!secretKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${secretKey}`;
  }

  return headers;
}

async function readAdminResponse(response: Response): Promise<AdminResult> {
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body && typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message
      : `Supabase REST 요청에 실패했습니다. status=${response.status}`;
    return { data: null, error: { message } };
  }
  return { data: body, error: null };
}
