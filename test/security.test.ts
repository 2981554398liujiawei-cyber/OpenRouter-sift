import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { startServer } from "../src/server";
import { safeResponseBodyForLogging } from "../src/server";

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof startServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
});

describe("configuration privacy", () => {
  it("does not expose upstream or local API keys from /config", async () => {
    const cfg = loadConfig({});
    cfg.port = 0;
    cfg.upstream_api_key = "sk-or-secret";
    cfg.local_api_key = "local-secret";
    cfg.log_level = "silent";
    const server = startServer(cfg);
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const response = await nativeFetch(`http://127.0.0.1:${address.port}/config`);
    const body = await response.json() as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(body).not.toHaveProperty("upstream_api_key");
    expect(body).not.toHaveProperty("local_api_key");
  });

  it("redacts JSON response bodies and omits non-JSON bodies when redaction is enabled", () => {
    expect(safeResponseBodyForLogging('{"api_key":"secret","content":"ok"}', true)).toContain("[REDACTED]");
    expect(safeResponseBodyForLogging("data: sensitive", true)).toContain("omitted");
  });
});
