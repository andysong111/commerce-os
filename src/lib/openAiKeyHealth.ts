export const OPENAI_KEY_HEALTH_LANES = [
  {
    id: "keyword_engine",
    label: "Keyword Engine",
    envName: "KEYWORD_ENGINE_OPENAI_API_KEY",
  },
  {
    id: "category_ai",
    label: "Category AI",
    envName: "SHOPLING_CATEGORY_OPENAI_API_KEY",
  },
  {
    id: "product_title_ai",
    label: "Product Title AI",
    envName: "PRODUCT_TITLE_OPENAI_API_KEY",
  },
  {
    id: "ops_ai_help",
    label: "Ops AI Help",
    envName: "OPS_AI_HELP_OPENAI_API_KEY",
  },
] as const;

type OpenAiKeyHealthLane = (typeof OPENAI_KEY_HEALTH_LANES)[number];

type OpenAiKeyProbeResult = {
  id: OpenAiKeyHealthLane["id"];
  label: string;
  envName: string;
  configured: boolean;
  ok: boolean;
  status: number | null;
  errorCode: string | null;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function safeErrorCode(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const error =
    payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
      ? (payload.error as Record<string, unknown>)
      : null;
  const code = error?.code ?? error?.type;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,120}$/.test(code)
    ? code
    : null;
}

export async function probeOpenAiKey(
  lane: OpenAiKeyHealthLane,
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<OpenAiKeyProbeResult> {
  const key = String(apiKey ?? "").trim();
  if (!key) {
    return {
      ...lane,
      configured: false,
      ok: false,
      status: null,
      errorCode: "NOT_CONFIGURED",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    return {
      ...lane,
      configured: true,
      ok: response.ok,
      status: response.status,
      errorCode: response.ok
        ? null
        : safeErrorCode(payload) ?? `HTTP_${response.status}`,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "UNKNOWN_ERROR";
    return {
      ...lane,
      configured: true,
      ok: false,
      status: null,
      errorCode: name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeConfiguredOpenAiKeys(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
) {
  return Promise.all(
    OPENAI_KEY_HEALTH_LANES.map((lane) =>
      probeOpenAiKey(lane, env[lane.envName], fetchImpl),
    ),
  );
}
