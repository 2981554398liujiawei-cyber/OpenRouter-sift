import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHORTCUT_NAME = "OpenRouter Sift.lnk";
const SCRIPT_NAME = "openrouter-sift-launch.vbs";

function ps(value: string): string { return `'${value.replace(/'/g, "''")}'`; }

function paths(): { desktop: string; shortcut: string; script: string; icon: string; cli: string } {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const launcherDirectory = join(localAppData, "OpenRouterSift");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return {
    desktop: join(homedir(), "Desktop"),
    shortcut: join(join(homedir(), "Desktop"), SHORTCUT_NAME),
    script: join(launcherDirectory, SCRIPT_NAME),
    icon: join(packageRoot, "assets", "openrouter-sift.ico"),
    cli: join(packageRoot, "dist", "server", "cli.js"),
  };
}

function ensureWindows(): void {
  if (process.platform !== "win32") throw new Error("Desktop shortcuts are supported on Windows only");
}

export function desktopShortcutPath(): string {
  ensureWindows();
  return paths().shortcut;
}

export function createDesktopShortcut(): { path: string } {
  ensureWindows();
  const target = paths();
  mkdirSync(dirname(target.script), { recursive: true });
  const script = [
    'Option Explicit',
    `CreateObject("WScript.Shell").Run """${process.execPath.replace(/"/g, '""')}"" ""${target.cli.replace(/"/g, '""')}"" launch", 0, False`,
  ].join("\r\n") + "\r\n";
  writeFileSync(target.script, script, { encoding: "utf8", mode: 0o600 });
  const command = [
    "$ws = New-Object -ComObject WScript.Shell",
    `$s = $ws.CreateShortcut(${ps(target.shortcut)})`,
    `$s.TargetPath = ${ps(join(process.env.WINDIR || "C:\\Windows", "System32", "wscript.exe"))}`,
    `$s.Arguments = ${ps(target.script)}`,
    `$s.WorkingDirectory = ${ps(dirname(target.cli))}`,
    `$s.IconLocation = ${ps(target.icon)}`,
    "$s.Description = 'OpenRouter Sift local gateway'",
    "$s.Save()",
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, stdio: "ignore" });
  return { path: target.shortcut };
}

export function removeDesktopShortcut(): { path: string; removed: boolean } {
  ensureWindows();
  const target = paths();
  if (!existsSync(target.shortcut)) return { path: target.shortcut, removed: false };
  unlinkSync(target.shortcut);
  return { path: target.shortcut, removed: true };
}
