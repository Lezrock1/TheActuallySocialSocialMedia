import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { isBlockedAddress } from "../ipPolicy.js";

export class UnsafeUrlError extends Error {}

const BLOCKED_MESSAGE = "This provider URL is not allowed. Use a public https address.";
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp"];

export function parseProviderUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("The provider URL is invalid.");
  }
  const protocolAllowed = url.protocol === "https:" || (allowPrivate && url.protocol === "http:");
  if (!protocolAllowed || url.username || url.password) throw new UnsafeUrlError(BLOCKED_MESSAGE);

  if (!allowPrivate) {
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const isLiteral = isIP(host) !== 0;
    if (
      !host ||
      (isLiteral && isBlockedAddress(host)) ||
      (!isLiteral && (!host.includes(".") || host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))))
    ) {
      throw new UnsafeUrlError(BLOCKED_MESSAGE);
    }
  }
  return url;
}

// Resolves and validates every address, so the connection can only reach the checked IP.
export function createGuardedLookup(allowPrivate = false): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const list = addresses as dns.LookupAddress[];
      if (list.length === 0 || (!allowPrivate && list.some((entry) => isBlockedAddress(entry.address)))) {
        callback(new UnsafeUrlError(BLOCKED_MESSAGE), "", 0);
        return;
      }
      if (options.all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

export async function assertProviderUrlAllowed(raw: string, allowPrivate = false): Promise<void> {
  const url = parseProviderUrl(raw, allowPrivate);
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return;
  await new Promise<void>((resolve, reject) => {
    createGuardedLookup(false)(host, {}, (error) => (error ? reject(error) : resolve()));
  }).catch((error: unknown) => {
    if (error instanceof UnsafeUrlError) throw error;
    throw new UnsafeUrlError("The provider host could not be resolved.");
  });
}

export interface SafeResponse {
  status: number;
  text: string;
}

export interface SafePostOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  allowPrivate?: boolean;
}

// Never follows redirects: a 3xx is returned as-is and treated as an error by callers.
export async function safePostJson(rawUrl: string, body: string, options: SafePostOptions = {}): Promise<SafeResponse> {
  const allowPrivate = options.allowPrivate ?? false;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const url = parseProviderUrl(rawUrl, allowPrivate);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise<SafeResponse>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: "POST",
        agent: false,
        lookup: createGuardedLookup(allowPrivate),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        headers: {
          ...options.headers,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let tooLarge = false;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            tooLarge = true;
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (tooLarge) {
            reject(new Error("Provider response is too large"));
            return;
          }
          resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
        });
        response.on("close", () => {
          if (!response.complete || tooLarge) reject(new Error("Provider response was interrupted"));
        });
        response.on("error", reject);
      }
    );
    request.on("error", reject);
    request.end(body);
  });
}
