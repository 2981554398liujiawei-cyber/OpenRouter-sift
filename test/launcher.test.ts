import { afterEach, describe, expect, it, vi } from "vitest";
import { createLaunchToken, LauncherLease, launcherUrl } from "../src/launcher";

afterEach(() => vi.useRealTimers());

describe("G15 launcher lease", () => {
  it("requires the launch token, supports multiple tabs, and exits after the grace period", () => {
    vi.useFakeTimers();
    const onExit = vi.fn();
    const token = createLaunchToken();
    const lease = new LauncherLease({ token, startupTimeoutMs: 100, graceMs: 50, onExit });
    expect(lease.handle("wrong", "client_12345678901234", "acquire")).toBe(false);
    expect(lease.handle(token, "client_12345678901234", "acquire")).toBe(true);
    expect(lease.handle(token, "client_22345678901234", "acquire")).toBe(true);
    expect(lease.handle(token, "client_12345678901234", "release")).toBe(true);
    vi.advanceTimersByTime(100);
    expect(onExit).not.toHaveBeenCalled();
    expect(lease.handle(token, "client_22345678901234", "heartbeat")).toBe(true);
    expect(lease.handle(token, "client_22345678901234", "release")).toBe(true);
    vi.advanceTimersByTime(49);
    expect(onExit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(lease.handle(token, "client_32345678901234", "acquire")).toBe(false);
  });

  it("times out when the launcher never connects", () => {
    vi.useFakeTimers();
    const onExit = vi.fn();
    const lease = new LauncherLease({ token: createLaunchToken(), startupTimeoutMs: 100, onExit });
    vi.advanceTimersByTime(100);
    expect(onExit).toHaveBeenCalledTimes(1);
    lease.close();
  });

  it("puts the capability only in the URL fragment", () => {
    const url = launcherUrl("127.0.0.1", 8787, "a-secret-token");
    expect(url).toBe("http://127.0.0.1:8787/ui/#launch=a-secret-token");
    expect(url).not.toContain("/api/");
  });
});
