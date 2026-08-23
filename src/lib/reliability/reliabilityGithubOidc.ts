import { createPublicKey, verify } from "node:crypto";

const ISSUER = "https://token.actions.githubusercontent.com";
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const AUDIENCE = "commerce-os-reliability-autofix";
const ALLOWED_REPOSITORIES = new Set([
  "andysong111/commerce-os-ops-center",
  "andysong111/commerce-os-detail-page-saas",
]);
const ALLOWED_EVENTS = new Set(["schedule", "workflow_dispatch"]);

type JwtHeader = {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
};

type GithubOidcClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  repository?: unknown;
  ref?: unknown;
  workflow?: unknown;
  event_name?: unknown;
  run_id?: unknown;
  run_attempt?: unknown;
};

export type ReliabilityGithubIdentity = {
  repository: string;
  runId: string;
  runAttempt: string;
  workflow: string;
};

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

function parseJson<T>(buffer: Buffer): T {
  return JSON.parse(buffer.toString("utf8")) as T;
}

function stringValue(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function audienceIncludes(value: unknown, expected: string) {
  if (typeof value === "string") return value === expected;
  return Array.isArray(value) && value.some((item) => item === expected);
}

async function githubJwk(kid: string) {
  const discoveryResponse = await fetch(DISCOVERY_URL, {
    cache: "force-cache",
    signal: AbortSignal.timeout(8_000),
  });
  if (!discoveryResponse.ok) {
    throw new Error("GitHub OIDC discovery를 확인하지 못했습니다.");
  }
  const discovery = (await discoveryResponse.json()) as { jwks_uri?: unknown };
  const jwksUri = stringValue(discovery.jwks_uri, 500);
  if (!jwksUri.startsWith(`${ISSUER}/`)) {
    throw new Error("GitHub OIDC JWKS 주소가 올바르지 않습니다.");
  }

  const jwksResponse = await fetch(jwksUri, {
    cache: "force-cache",
    signal: AbortSignal.timeout(8_000),
  });
  if (!jwksResponse.ok) {
    throw new Error("GitHub OIDC 서명키를 확인하지 못했습니다.");
  }
  const payload = (await jwksResponse.json()) as {
    keys?: Array<Record<string, unknown>>;
  };
  const key = (payload.keys ?? []).find(
    (candidate) => stringValue(candidate.kid, 200) === kid,
  );
  if (!key) throw new Error("GitHub OIDC 서명키가 일치하지 않습니다.");
  return key;
}

export async function verifyReliabilityGithubOidc(
  authorizationHeader: string | null,
): Promise<ReliabilityGithubIdentity> {
  const token = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length).trim()
    : "";
  if (!token) throw new Error("GitHub Actions OIDC 토큰이 없습니다.");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("GitHub Actions OIDC 토큰 형식이 잘못되었습니다.");

  const header = parseJson<JwtHeader>(decodeBase64Url(parts[0]));
  const claims = parseJson<GithubOidcClaims>(decodeBase64Url(parts[1]));
  const alg = stringValue(header.alg, 40);
  const kid = stringValue(header.kid, 200);
  if (alg !== "RS256" || !kid) {
    throw new Error("허용되지 않은 GitHub OIDC 서명 방식입니다.");
  }

  const jwk = await githubJwk(kid);
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  const signature = decodeBase64Url(parts[2]);
  if (!verify("RSA-SHA256", signed, publicKey, signature)) {
    throw new Error("GitHub Actions OIDC 서명 검증에 실패했습니다.");
  }

  const now = Math.floor(Date.now() / 1000);
  const issuer = stringValue(claims.iss, 200);
  const expiresAt = numberValue(claims.exp);
  const notBefore = numberValue(claims.nbf);
  const issuedAt = numberValue(claims.iat);
  const repository = stringValue(claims.repository, 240);
  const ref = stringValue(claims.ref, 300);
  const workflow = stringValue(claims.workflow, 200);
  const eventName = stringValue(claims.event_name, 100);
  const runId = stringValue(claims.run_id, 100);
  const runAttempt = stringValue(claims.run_attempt, 40) || "1";

  if (issuer !== ISSUER || !audienceIncludes(claims.aud, AUDIENCE)) {
    throw new Error("GitHub Actions OIDC 발급자 또는 대상이 올바르지 않습니다.");
  }
  if (!expiresAt || expiresAt < now - 30 || notBefore > now + 30 || issuedAt > now + 30) {
    throw new Error("GitHub Actions OIDC 토큰 유효시간이 올바르지 않습니다.");
  }
  if (!ALLOWED_REPOSITORIES.has(repository)) {
    throw new Error("자동수정이 허용되지 않은 GitHub 저장소입니다.");
  }
  if (ref !== "refs/heads/main") {
    throw new Error("자동수정 Worker는 main 기준 실행만 허용됩니다.");
  }
  if (workflow !== "Reliability Safe Autofix" || !ALLOWED_EVENTS.has(eventName)) {
    throw new Error("허용되지 않은 GitHub Actions 실행입니다.");
  }
  if (!runId) throw new Error("GitHub Actions run_id가 없습니다.");

  return { repository, runId, runAttempt, workflow };
}

export const RELIABILITY_AUTOFIX_OIDC_AUDIENCE = AUDIENCE;
