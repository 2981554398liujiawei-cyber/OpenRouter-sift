import type { IncomingMessage } from "node:http";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True only for loopback-only binds where the localhost trust model applies. */
export function isStrictLoopbackBind(host: string): boolean {
  const value = host.toLowerCase();
  return value === "" || value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

/** Wildcard or LAN binds expose the server beyond localhost and need control auth. */
export function isNonLoopbackBind(host: string): boolean {
  return !isStrictLoopbackBind(host);
}

/** Strip the port (and IPv6 brackets) from a Host header, returning the hostname or null. */
export function hostnameFromHostHeader(host: string | undefined): string | null {
  if (!host) return null;
  const value = host.trim();
  if (!value) return null;
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    return close > 0 ? value.slice(1, close).toLowerCase() : null;
  }
  const colon = value.lastIndexOf(":");
  if (colon > 0 && value.indexOf("]") < 0 && !Number.isNaN(Number(value.slice(colon + 1)))) {
    return value.slice(0, colon).toLowerCase();
  }
  return value.toLowerCase();
}

/** True when an Origin header's hostname is a loopback host. */
export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export interface HostGuardResult { ok: boolean; reason?: "HOST" | "ORIGIN" }

/**
 * Localhost trust guard. When the server binds loopback, browsers (and DNS
 * rebinding tricks) must not be able to drive the control plane with a foreign
 * Host or Origin. CLI/curl clients send neither header and keep working.
 */
export function guardLocalRequest(req: IncomingMessage, bindHost: string): HostGuardResult {
  if (!isStrictLoopbackBind(bindHost)) return { ok: true };
  const host = hostnameFromHostHeader(req.headers.host);
  if (host !== null && !LOOPBACK_HOSTNAMES.has(host)) return { ok: false, reason: "HOST" };
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== "null" && !isLoopbackOrigin(origin)) return { ok: false, reason: "ORIGIN" };
  return { ok: true };
}
