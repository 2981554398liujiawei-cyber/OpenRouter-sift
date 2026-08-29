import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

/**
 * Atomic JSON persistence with restrictive Unix permissions (files 0600,
 * directories 0700). Windows ignores mode bits and relies on the user's ACL.
 * Writes go to a sibling temp file and rename into place, so a crash mid-write
 * never leaves a half-written JSON document.
 */
export function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { chmodSync(temporary, 0o600); } catch { /* Windows: no-op */ }
  try {
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* preserve the original error */ }
    throw error;
  }
  try { chmodSync(path, 0o600); } catch { /* Windows: no-op */ }
}
