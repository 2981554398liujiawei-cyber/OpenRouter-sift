import { existsSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function notFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Control UI asset not found");
}

/** Serves the separately built Vite UI without allowing paths outside its output directory. */
export function serveControlUi(req: IncomingMessage, res: ServerResponse, pathname: string, outputDirectory: string): boolean {
  if (pathname !== "/ui" && !pathname.startsWith("/ui/")) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return true;
  }
  if (pathname === "/ui") {
    res.writeHead(302, { location: "/ui/" });
    res.end();
    return true;
  }

  let requested: string;
  try {
    requested = decodeURIComponent(pathname.slice("/ui/".length)) || "index.html";
  } catch {
    notFound(res);
    return true;
  }
  if (requested.includes("\\") || requested.includes("\0")) {
    notFound(res);
    return true;
  }
  const root = resolve(outputDirectory);
  if (!existsSync(root)) {
    notFound(res);
    return true;
  }
  const realRoot = realpathSync(root);
  let target = resolve(root, requested);
  const withinRoot = relative(root, target);
  if (withinRoot.startsWith("..") || isAbsolute(withinRoot)) {
    notFound(res);
    return true;
  }
  if (!existsSync(target) || statSync(target).isDirectory()) {
    // State-based navigation does not need this fallback today, but it keeps a bookmarked UI route usable.
    if (!extname(requested)) target = resolve(root, "index.html");
    if (!existsSync(target) || statSync(target).isDirectory()) {
      notFound(res);
      return true;
    }
  }
  // A lexical check alone is insufficient when an asset path is a symlink.
  const realTarget = realpathSync(target);
  const withinRealRoot = relative(realRoot, realTarget);
  if (withinRealRoot.startsWith("..") || isAbsolute(withinRealRoot)) {
    notFound(res);
    return true;
  }
  const extension = extname(realTarget).toLowerCase();
  res.writeHead(200, {
    "content-type": contentTypes[extension] ?? "application/octet-stream",
    "cache-control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  if (req.method === "HEAD") {
    res.end();
  } else {
    createReadStream(realTarget).pipe(res);
  }
  return true;
}
