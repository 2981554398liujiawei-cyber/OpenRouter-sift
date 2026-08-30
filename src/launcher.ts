import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";

export interface LauncherOptions {
  token: string;
  startupTimeoutMs?: number;
  graceMs?: number;
  onExit: () => void;
}

function equalSecret(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validClientId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

export class LauncherLease {
  private readonly clients = new Set<string>();
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly options: LauncherOptions) {
    this.startupTimer = setTimeout(() => this.exit(), options.startupTimeoutMs ?? 30_000);
    this.startupTimer.unref?.();
  }

  handle(token: unknown, clientId: unknown, action: unknown): boolean {
    if (this.closed || typeof token !== "string" || !equalSecret(this.options.token, token) || !validClientId(clientId)) return false;
    if (action === "acquire" || action === "heartbeat") {
      this.clients.add(clientId);
      if (this.startupTimer) clearTimeout(this.startupTimer);
      if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = undefined; }
      return true;
    }
    if (action === "release") {
      this.clients.delete(clientId);
      if (this.clients.size === 0) this.scheduleGracefulExit();
      return true;
    }
    return false;
  }

  private scheduleGracefulExit(): void {
    if (this.graceTimer || this.closed) return;
    this.graceTimer = setTimeout(() => this.exit(), this.options.graceMs ?? 5_000);
    this.graceTimer.unref?.();
  }

  private exit(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.options.onExit();
  }

  close(): void {
    this.closed = true;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.clients.clear();
  }
}

export function createLaunchToken(): string {
  return randomBytes(32).toString("base64url");
}

export function launcherUrl(host: string, port: number, token: string): string {
  return `http://${host}:${port}/ui/#launch=${encodeURIComponent(token)}`;
}

export function openBrowser(url: string): void {
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = execFile(command, args, { windowsHide: true });
  child.on("error", () => undefined);
  child.unref();
}
