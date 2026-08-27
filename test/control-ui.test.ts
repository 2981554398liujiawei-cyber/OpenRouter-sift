import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { serveControlUi } from "../src/controlUi";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
});

describe("control UI static assets", () => {
  it("serves only the /ui namespace and rejects traversal", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openrouter-control-ui-"));
    try {
      writeFileSync(join(directory, "index.html"), "<main>OpenRouter Control</main>");
      const server = http.createServer((req, res) => {
        if (!serveControlUi(req, res, new URL(req.url ?? "/", "http://localhost").pathname, directory)) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end('{"route":"outside-ui"}');
        }
      });
      servers.push(server);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      const base = `http://127.0.0.1:${address.port}`;

      const redirect = await fetch(`${base}/ui`, { redirect: "manual" });
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get("location")).toBe("/ui/");
      expect(await (await fetch(`${base}/ui/`)).text()).toContain("OpenRouter Control");
      expect((await fetch(`${base}/api/status`)).headers.get("content-type")).toContain("application/json");
      expect((await fetch(`${base}/ui/%5c..%5cpackage.json`)).status).toBe(404);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
