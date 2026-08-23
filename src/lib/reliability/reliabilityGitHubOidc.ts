import { createPublicKey, verify } from "node:crypto";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
export const RELIABILITY_AUTO_IMPROVEMENT_AUDIENCE =
  "commerce-os-reliability-auto-improvement";

const ALLOWED_WORKFLOWS: Record<string, string> = {
  "andysong111/commerce-os-ops-center":
    "andysong111/commerce-os-ops-center/.github/workflows/reliability-auto-improvement.yml@refs/heads/main",
  "andysong111/commerce-os-detail-page-saas":
    "andysong111/commerce-os-detail-page-saas/.github/workflows/reliability-auto-improvement.yml@refs/heads/main",
};

export type ReliabilityGitHubRunnerIdentity = {
  repository: string;
  workflowRef: string;
  runId: string;
  actor: string;
  eventName: string;
};

type JwtHeader = { alg?: unknown; kid?: unknown; typ?: unknown };
type JwtClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  repository?: unknown;
  ref?: unknown;
  workflow_ref?: unknown;
  run_id?: unknown;
  actor?: unknown;
  event_name?: unknown;
};

type JwksPayload = { keys?: Array<Record<string, unknown>> };

function decodeJson<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function audienceMatches(value: unknown) {
  if (typeof value === "string") return value === RELIABILITY_AUTO_IMPROVEMENT_AUDIENCE;
  if (Array.isArray(value)) {
    return value.some((item) => item === RELIABILITY_AUTO_IMPROVEMENT_AUDIENCE);
  }
  return false;
}

async function verifySignature(token: string, header: JwtHeader) {
  const kid = asText(header.kid);
  if (header.alg !== "RS256" || !kid) return false;
  const response = await fetch(GITHUB_OIDC_JWKS, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("GitHub 실행 인증키를 확인하지 못했습니다.");
  const jwks = (await response.json()) as JwksPayload;
  const jwk = jwks.keys?.find((candidate) => candidate.kid === kid);
  if (!jwk) return false;

  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return false;
  const key = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
  return verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8"),
    key,
    Buffer.from(encodedSignature, "base64url"),
  );
}

export async function authorizeReliabilityGitHubRunner(
  request: Request,
): Promise<
  | { ok: true; identity: ReliabilityGitHubRunnerIdentity }
  | { ok: false; status: number; message: string }
> {
  const authorization = String(request.headers.get("authorization") ?? "").trim();
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!token) return { ok: false, status: 401, message: "자동개선 실행 인증이 없습니다." };

  const segments = token.split(".");
  if (segments.length !== 3) {
    return { ok: false, status: 401, message: "자동개선 실행 인증 형식이 올바르지 않습니다." };
  }

  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = decodeJson<JwtHeader>(segments[0]);
    claims = decodeJson<JwtClaims>(segments[1]);
  } catch {
    return { ok: false, status: 401, message: "자동개선 실행 인증을 읽지 못했습니다." };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = Number(claims.exp ?? 0);
  const nbf = Number(claims.nbf ?? 0);
  const repository = asText(claims.repository);
  const ref = asText(claims.ref);
  const workflowRef = asText(claims.workflow_ref);
  const expectedWorkflow = ALLOWED_WORKFLOWS[repository];
  const eventName = asText(claims.event_name);

  if (
    claims.iss !== GITHUB_OIDC_ISSUER ||
    !audienceMatches(claims.aud) ||
    !Number.isFinite(exp) ||
    exp <= now ||
    (Number.isFinite(nbf) && nbf > now + 30) ||
    !expectedWorkflow ||
    workflowRef !== expectedWorkflow ||
    ref !== "refs/heads/main" ||
    !["schedule", "workflow_dispatch", "push"].includes(eventName)
  ) {
    return { ok: false, status: 403, message: "허용된 자동개선 실행이 아닙니다." };
  }

  try {
    if (!(await verifySignature(token, header))) {
      return { ok: false, status: 401, message: "자동개선 실행 서명을 확인하지 못했습니다." };
    }
  } catch {
    return { ok: false, status: 503, message: "자동개선 실행 인증 확인이 일시적으로 불가능합니다." };
  }

  return {
    ok: true,
    identity: {
      repository,
      workflowRef,
      runId: asText(claims.run_id),
      actor: asText(claims.actor),
      eventName,
    },
  };
}
