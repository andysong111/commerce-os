import { Agent, request } from "node:https";
import type { IncomingHttpHeaders } from "node:http";

export type ShoplingTransportMode = "standard" | "scoped_legacy_dh";

export type ShoplingTransportResponse = {
  ok: boolean;
  status: number;
  headers: Headers;
  transportMode: ShoplingTransportMode;
  text: () => Promise<string>;
};

type ErrorRecord = Record<string, unknown>;

const SHOPLING_LEGACY_DH_HOST = "api.shopling.co.kr";
const SHOPLING_LEGACY_DH_CIPHERS = "DEFAULT@SECLEVEL=1";
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

function record(value: unknown): ErrorRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ErrorRecord)
    : {};
}

export function shoplingTlsErrorCode(error: unknown) {
  let current = record(error);
  for (let depth = 0; depth < 4; depth += 1) {
    const code = String(current.code ?? "").trim();
    if (code) return code;
    current = record(current.cause);
    if (!Object.keys(current).length) break;
  }
  return "";
}

export function isShoplingWeakDhFailure(error: unknown) {
  return shoplingTlsErrorCode(error) === "ERR_SSL_DH_KEY_TOO_SMALL";
}

export function isScopedShoplingLegacyDhTarget(value: string | URL) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === SHOPLING_LEGACY_DH_HOST &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function responseHeaders(source: IncomingHttpHeaders) {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(source)) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(name, value);
    } else {
      headers.set(name, String(raw));
    }
  }
  return headers;
}

async function standardPost(
  url: string,
  xml: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ShoplingTransportResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: xml,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    transportMode: "standard",
    text: () => response.text(),
  };
}

function scopedLegacyDhPost(
  rawUrl: string,
  xml: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ShoplingTransportResponse> {
  const url = new URL(rawUrl);
  if (!isScopedShoplingLegacyDhTarget(url)) {
    throw new Error("SHOPLING_LEGACY_DH_TARGET_REJECTED");
  }
  const body = Buffer.from(xml, "utf8");
  const agent = new Agent({
    keepAlive: false,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    ciphers: SHOPLING_LEGACY_DH_CIPHERS,
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      agent.destroy();
      callback();
    };
    const requestHandle = request(
      {
        protocol: "https:",
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          ...headers,
          "content-length": String(body.byteLength),
        },
        agent,
        servername: url.hostname,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        ciphers: SHOPLING_LEGACY_DH_CIPHERS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk, "utf8");
          size += buffer.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            requestHandle.destroy(
              Object.assign(new Error("SHOPLING_RESPONSE_TOO_LARGE"), {
                code: "SHOPLING_RESPONSE_TOO_LARGE",
              }),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.once("error", (error) => finish(() => reject(error)));
        response.once("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode ?? 0;
          finish(() =>
            resolve({
              ok: status >= 200 && status < 300,
              status,
              headers: responseHeaders(response.headers),
              transportMode: "scoped_legacy_dh",
              text: async () => text,
            }),
          );
        });
      },
    );
    requestHandle.setTimeout(timeoutMs, () => {
      requestHandle.destroy(
        Object.assign(new Error("SHOPLING_LEGACY_DH_TIMEOUT"), {
          code: "SHOPLING_LEGACY_DH_TIMEOUT",
        }),
      );
    });
    requestHandle.once("error", (error) => finish(() => reject(error)));
    requestHandle.end(body);
  });
}

export async function postShoplingXml(
  url: string,
  xml: string,
  options: {
    headers: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<ShoplingTransportResponse> {
  const timeoutMs = Math.max(
    1_000,
    Math.min(60_000, Math.trunc(options.timeoutMs ?? 45_000)),
  );
  try {
    return await standardPost(url, xml, options.headers, timeoutMs);
  } catch (error) {
    if (
      !isShoplingWeakDhFailure(error) ||
      !isScopedShoplingLegacyDhTarget(url)
    ) {
      throw error;
    }
    return scopedLegacyDhPost(url, xml, options.headers, timeoutMs);
  }
}
