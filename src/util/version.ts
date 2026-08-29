import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

let cachedVersion: string | null = null;

export function getVersion(): string {
  if (cachedVersion) return cachedVersion;

  const pathsToTry = [
    // Development path
    resolve(process.cwd(), "package.json"),
    // Installed package path
    (() => {
      try {
        const __filename = fileURLToPath(import.meta.url);
        return join(dirname(__filename), "..", "..", "package.json");
      } catch {
        return null;
      }
    })(),
    // Alternative installed path
    (() => {
      try {
        const __filename = fileURLToPath(import.meta.url);
        return join(dirname(__filename), "..", "package.json");
      } catch {
        return null;
      }
    })(),
  ].filter((item): item is string => Boolean(item));

  for (const pkgPath of pathsToTry) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (typeof pkg.version === "string" && pkg.version) {
        cachedVersion = pkg.version;
        return pkg.version;
      }
    } catch {
      // Try next path
    }
  }

  cachedVersion = "unknown";
  return cachedVersion;
}

export function getGitCommit(): string | undefined {
  try {
    // This would require git, which may not be available
    // Return undefined for now
    return undefined;
  } catch {
    return undefined;
  }
}
