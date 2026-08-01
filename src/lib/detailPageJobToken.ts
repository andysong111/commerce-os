import { createHmac, timingSafeEqual } from "node:crypto";

type TokenConfig = { secretKey: string };

function tokenDigest(config: TokenConfig, ownerId: string, jobId: string) {
  return createHmac("sha256", config.secretKey)
    .update(`detail-page-job:v1:${ownerId}:${jobId}`)
    .digest("hex");
}

export function createDetailPageJobToken(
  config: TokenConfig,
  ownerId: string,
  jobId: string,
) {
  return tokenDigest(config, ownerId, jobId);
}

export function verifyDetailPageJobToken(
  config: TokenConfig,
  ownerId: string,
  jobId: string,
  provided: string,
) {
  const expected = Buffer.from(tokenDigest(config, ownerId, jobId));
  const actual = Buffer.from(provided.trim());
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
