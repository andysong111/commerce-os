type AdminResult = { data: unknown; error: { message: string } | null; count: number | null };
type OrderOptions = { ascending?: boolean };
type SelectOptions = { count?: "exact"; head?: boolean };

class SupabaseRestQuery implements PromiseLike<AdminResult> {
  private readonly params = new URLSearchParams();
  private count: "exact" | undefined;
  private head = false;
  private method: "GET" | "PATCH" = "GET";
  private requestBody: Record<string, unknown> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly secretKey: string,
    private readonly table: string,
  ) {}

  select(columns = "*", options: SelectOptions = {}) {
    this.params.set("select", columns);
    this.count = options.count;
    this.head = options.head === true;
    return this;
  }

  update(values: Record<string, unknown>) {
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new TypeError("Supabase REST update requires an object body.");
    }
    this.method = "PATCH";
    this.requestBody = values;
    this.head = false;
    return this;
  }

  eq(column: string, value: unknown) {
    this.params.append(column, `eq.${String(value)}`);
    return this;
  }

  gt(column: string, value: unknown) {
    this.params.append(column, `gt.${String(value)}`);
    return this;
  }

  lt(column: string, value: unknown) {
    this.params.append(column, `lt.${String(value)}`);
    return this;
  }

  is(column: string, value: null | boolean) {
    this.params.append(column, `is.${value === null ? "null" : String(value)}`);
    return this;
  }

  not(column: string, operator: "is", value: null | boolean) {
    this.params.append(column, `not.${operator}.${value === null ? "null" : String(value)}`);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    if (values.length === 0) throw new TypeError("Supabase REST in filter requires at least one value.");
    const encodedValues = values.map((value) => {
      const text = String(value);
      return /^[A-Za-z0-9_]+$/.test(text) ? text : `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    });
    this.params.append(column, `in.(${encodedValues.join(",")})`);
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

  range(from: number, to: number) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
      throw new TypeError("Supabase REST range requires integer bounds with 0 <= from <= to.");
    }
    this.params.set("offset", String(from));
    this.params.set("limit", String(to - from + 1));
    return this;
  }

  async maybeSingle(): Promise<AdminResult> {
    this.params.set("limit", "1");
    const result = await this.execute();
    if (result.error) return result;
    const rows = Array.isArray(result.data) ? result.data : [];
    return { data: rows[0] ?? null, error: null, count: result.count };
  }

  then<TResult1 = AdminResult, TResult2 = never>(
    onfulfilled?: ((value: AdminResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<AdminResult> {
    const headers = createSupabaseAdminHeaders(this.secretKey);
    const preferences: string[] = [];
    if (this.count === "exact") preferences.push("count=exact");
    if (this.method === "PATCH") preferences.push("return=representation");
    if (preferences.length > 0) headers.Prefer = preferences.join(",");
    const response = await fetch(`${this.baseUrl}/rest/v1/${encodeURIComponent(this.table)}?${this.params.toString()}`, {
      method: this.head ? "HEAD" : this.method,
      headers,
      body: this.method === "PATCH" ? JSON.stringify(this.requestBody ?? {}) : undefined,
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
    return { data: null, error: { message }, count: null };
  }
  const total = response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
  return { data: body, error: null, count: total === undefined ? null : Number(total) };
}
