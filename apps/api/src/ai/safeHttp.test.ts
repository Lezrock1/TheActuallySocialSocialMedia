import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createGuardedLookup,
  parseProviderUrl,
  safePostJson,
  UnsafeUrlError,
} from "./safeHttp.js";

describe("parseProviderUrl", () => {
  it.each([
    "http://api.example.com/v1",
    "https://user:secret@api.example.com/v1",
    "https://localhost/v1",
    "https://foo.localhost/v1",
    "https://127.0.0.1/v1",
    "https://[::1]/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://2130706433/",
    "https://0x7f.1/",
    "https://storage:8333/",
    "https://postgres/",
    "https://metadata.internal/",
    "https://printer.local/",
    "ftp://example.com/",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => parseProviderUrl(url)).toThrow(UnsafeUrlError);
  });

  it("accepts public https hosts", () => {
    expect(parseProviderUrl("https://openrouter.ai/api/v1").hostname).toBe("openrouter.ai");
    expect(parseProviderUrl("https://api.openai.com/v1").hostname).toBe("api.openai.com");
  });

  it("allows private http only when explicitly enabled", () => {
    expect(parseProviderUrl("http://localhost:11434/v1", true).port).toBe("11434");
  });
});

describe("createGuardedLookup", () => {
  it("rejects hostnames that resolve to loopback", async () => {
    const error = await new Promise<Error | null>((resolve) => {
      createGuardedLookup(false)("localhost", {}, (lookupError) => resolve(lookupError));
    });
    expect(error).toBeInstanceOf(UnsafeUrlError);
  });

  it("allows loopback when private access is enabled", async () => {
    const error = await new Promise<Error | null>((resolve) => {
      createGuardedLookup(true)("localhost", {}, (lookupError) => resolve(lookupError));
    });
    expect(error).toBeNull();
  });
});

describe("safePostJson", () => {
  const paths: string[] = [];
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      paths.push(request.url ?? "");
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/target" });
        response.end();
      } else if (request.url === "/large") {
        response.writeHead(200);
        response.end("x".repeat(5_000));
      } else {
        response.writeHead(200);
        response.end('{"ok":true}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("returns the response body", async () => {
    const result = await safePostJson(`${base}/ok`, "{}", { allowPrivate: true });
    expect(result).toEqual({ status: 200, text: '{"ok":true}' });
  });

  it("does not follow redirects", async () => {
    const result = await safePostJson(`${base}/redirect`, "{}", { allowPrivate: true });
    expect(result.status).toBe(302);
    expect(paths).not.toContain("/target");
  });

  it("aborts oversized responses", async () => {
    await expect(
      safePostJson(`${base}/large`, "{}", { allowPrivate: true, maxBytes: 1_000 })
    ).rejects.toThrow();
  });

  it("refuses private targets by default", async () => {
    await expect(safePostJson(`${base}/ok`, "{}")).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
