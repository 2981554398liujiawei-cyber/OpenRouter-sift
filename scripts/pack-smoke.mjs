/* global URL, console, fetch, process, setTimeout */

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const smokeDir = mkdtempSync(join(tmpdir(), "openrouter-sift-pack-smoke-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const runNpm = (args, options = {}) => {
  if (process.platform === "win32") {
    return execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", [npm, ...args].join(" ")], options);
  }
  return execFileSync(npm, args, options);
};
let tarballPath;
let child;

try {
  const tarball = runNpm(["pack", "--silent"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).at(-1);
  if (!tarball) throw new Error("npm pack did not produce a tarball");
  tarballPath = join(root, tarball);
  const smokeTarball = join(smokeDir, tarball);
  copyFileSync(tarballPath, smokeTarball);
  runNpm(["init", "-y"], { cwd: smokeDir, stdio: "ignore" });
  runNpm(["install", "--ignore-scripts", `./${tarball}`], { cwd: smokeDir, stdio: "inherit" });

  const packageRoot = join(smokeDir, "node_modules", "openrouter-provider-shim");
  const entry = join(packageRoot, "dist", "server", "cli.js");
  const version = execFileSync(process.execPath, [entry, "--version"], { encoding: "utf8" }).trim();
  const expected = execFileSync(process.execPath, ["-e", "process.stdout.write(require('./package.json').version)"], { cwd: root, encoding: "utf8" }).trim();
  if (version !== expected) throw new Error(`version mismatch: ${version} !== ${expected}`);

  const port = 18987;
  child = spawn(process.execPath, [entry, "serve", "--host", "127.0.0.1", "--port", String(port), "--log-level", "silent"], { cwd: smokeDir, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
    try {
      const response = await fetch(`${base}/healthz`);
      ready = response.ok;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  if (!ready) throw new Error("installed package did not serve /healthz");
  const checks = await Promise.all([fetch(`${base}/healthz`), fetch(`${base}/version`), fetch(`${base}/ui/`)]);
  if (!checks[0].ok || !checks[1].ok || !checks[2].ok) throw new Error(`installed package smoke failed: ${checks.map((item) => item.status).join(",")}`);
  console.log(`PACK_SMOKE_OK version=${version} healthz=${checks[0].status} versionEndpoint=${checks[1].status} ui=${checks[2].status}`);
} finally {
  if (child && !child.killed) {
    child.kill();
    await new Promise((resolveExit) => child.once("exit", resolveExit));
  }
  if (tarballPath) rmSync(tarballPath, { force: true });
  rmSync(smokeDir, { recursive: true, force: true });
}
