import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * OS-backed storage for the upstream OpenRouter API key. Implementations must
 * never write plaintext to a project-visible file; each backend delegates to
 * the operating system's own credential facility.
 */
export interface SecureKeyStore {
  /** Human-readable backend name shown in the Settings UI (e.g. "Windows Credential Manager"). */
  readonly label: string;
  /** Best-effort reachability check for the underlying OS facility. */
  available(): boolean;
  load(): string | null;
  /** Throws when the OS refuses the write; callers must not fall back to plaintext. */
  save(key: string): void;
  clear(): void;
}

export class SecureKeyStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecureKeyStoreUnavailableError";
  }
}

const SERVICE = "OpenRouterSift";
const ACCOUNT = "upstream-openrouter-key";

function safeAccount(account: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(account)) throw new Error("Invalid secure credential account");
  return account;
}

function run(command: string, args: string[], options: { input?: string } = {}): string {
  return execFileSync(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, encoding: "utf8", ...options }) as string;
}

/** Windows Credential Manager via CredWrite/CredRead P/Invoke (generic credential). */
class WindowsCredentialStore implements SecureKeyStore {
  readonly label = "Windows Credential Manager";

  constructor(private readonly account: string) {}

  available(): boolean { return true; }

  private script(action: "read" | "write" | "delete", key?: string): string {
    const valueLiteral = JSON.stringify(key ?? "");
    return [
      `$ErrorActionPreference = 'Stop'`,
      `Add-Type -TypeDefinition @'`,
      `using System;`,
      `using System.Runtime.InteropServices;`,
      `public static class CredMan {`,
      `  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]`,
      `  public struct CREDENTIAL {`,
      `    public int Flags; public int Type; public string TargetName; public string Comment;`,
      `    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;`,
      `    public int CredentialBlobSize; public IntPtr CredentialBlob;`,
      `    public int Persist; public int AttributeCount; public IntPtr Attributes;`,
      `    public string TargetAlias; public string UserName; }`,
      `  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]`,
      `  public static extern bool CredWrite(ref CREDENTIAL credential, int flags);`,
      `  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]`,
      `  public static extern bool CredRead(string target, int type, int flags, out IntPtr credentialPtr, out int size);`,
      `  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]`,
      `  public static extern void CredFree(IntPtr buffer);`,
      `  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]`,
      `  public static extern bool CredDelete(string target, int type, int flags); }`,
      `'@`,
      `$target = '${SERVICE}\\${this.account}'`,
      action === "write" && `
      $credential = New-Object CredMan+CREDENTIAL
      $credential.Flags = 0
      $credential.Type = 1
      $credential.TargetName = $target
      $credential.UserName = '${this.account}'
      $credential.CredentialBlob = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni(${valueLiteral})
      $credential.CredentialBlobSize = [Text.Encoding]::Unicode.GetByteCount(${valueLiteral})
      $credential.Persist = 2
      $credential.AttributeCount = 0
      try {
        if (-not [CredMan]::CredWrite([ref]$credential, 0)) { throw "CredWrite failed with $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
      } finally { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($credential.CredentialBlob) }`,
      action === "read" && `
      $ptr = [IntPtr]::Zero
      $size = 0
      if (-not [CredMan]::CredRead($target, 1, 0, [ref]$ptr, [ref]$size)) { exit 2 }
      try {
        $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredMan+CREDENTIAL])
        $text = [Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, [Math]::Floor($cred.CredentialBlobSize / 2))
        [Console]::Out.Write($text)
      } finally { [CredMan]::CredFree($ptr) }`,
      action === "delete" && `
      if (-not [CredMan]::CredDelete($target, 1, 0)) { exit 2 }`,
    ].filter(Boolean).join("\n");
  }

  load(): string | null {
    try {
      const result = run("powershell", ["-NoProfile", "-NonInteractive", "-Command", this.script("read")]);
      const value = result.trim();
      return value ? value : null;
    } catch (err: any) {
      if (err?.status === 2) return null;
      return null;
    }
  }

  save(key: string): void {
    try {
      run("powershell", ["-NoProfile", "-NonInteractive", "-Command", this.script("write", key)]);
    } catch (err: any) {
      throw new SecureKeyStoreUnavailableError(`Windows Credential Manager write failed: ${err?.message ?? err}`);
    }
  }

  clear(): void {
    try {
      run("powershell", ["-NoProfile", "-NonInteractive", "-Command", this.script("delete")]);
    } catch {
      // Deleting an absent credential is fine.
    }
  }
}

/** macOS Keychain via the security(1) CLI. */
class MacKeychainStore implements SecureKeyStore {
  readonly label = "macOS Keychain";

  constructor(private readonly account: string) {}

  available(): boolean { return process.platform === "darwin" && existsSync("/usr/bin/security"); }

  load(): string | null {
    try {
      const result = run("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", this.account, "-w"]);
      const value = result.trim();
      return value || null;
    } catch {
      return null;
    }
  }

  save(key: string): void {
    try {
      run("/usr/bin/security", ["add-generic-password", "-s", SERVICE, "-a", this.account, "-w", key, "-U"]);
    } catch (err: any) {
      throw new SecureKeyStoreUnavailableError(`Keychain write failed: ${err?.message ?? err}`);
    }
  }

  clear(): void {
    try {
      run("/usr/bin/security", ["delete-generic-password", "-s", SERVICE, "-a", this.account]);
    } catch {
      // Absent entry is fine.
    }
  }
}

/**
 * Linux Secret Service via secret-tool. When secret-tool is missing the store
 * reports unavailable instead of degrading to plaintext storage.
 */
class LinuxSecretStore implements SecureKeyStore {
  readonly label = "Secret Service keyring";

  constructor(private readonly account: string) {}

  available(): boolean { return process.platform === "linux"; }

  private toolPath(): string | null {
    for (const candidate of ["/usr/bin/secret-tool", "/usr/local/bin/secret-tool", "/bin/secret-tool"]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  load(): string | null {
    const tool = this.toolPath();
    if (!tool) return null;
    try {
      const value = run(tool, ["lookup", "service", SERVICE, "account", this.account]).trim();
      return value || null;
    } catch {
      return null;
    }
  }

  save(key: string): void {
    const tool = this.toolPath();
    if (!tool) throw new SecureKeyStoreUnavailableError("secret-tool is not installed; install libsecret-tools to remember keys");
    try {
      run(tool, ["store", "service", SERVICE, "account", this.account], { input: key });
    } catch (err: any) {
      throw new SecureKeyStoreUnavailableError(`Secret Service write failed: ${err?.message ?? err}`);
    }
  }

  clear(): void {
    const tool = this.toolPath();
    if (!tool) return;
    try {
      run(tool, ["clear", "service", SERVICE, "account", this.account]);
    } catch {
      // Absent entry is fine.
    }
  }
}

/**
 * Fallback for platforms without a usable credential facility: nothing is
 * persisted at all. The manager surfaces `secureStoreAvailable: false` so the
 * UI can offer session-only configuration instead of pretending to remember.
 * Tests inject this to isolate spawned servers from the machine's real
 * persisted upstream key.
 */
export class NoopSecureStore implements SecureKeyStore {
  readonly label = "unavailable";
  available(): boolean { return false; }
  load(): string | null { return null; }
  save(): void { throw new SecureKeyStoreUnavailableError("No secure credential storage is available on this platform"); }
  clear(): void {}
}

export function createPlatformSecureStore(account = ACCOUNT): SecureKeyStore {
  const normalizedAccount = safeAccount(account);
  if (process.platform === "win32") return new WindowsCredentialStore(normalizedAccount);
  if (process.platform === "darwin") return new MacKeychainStore(normalizedAccount);
  if (process.platform === "linux") return new LinuxSecretStore(normalizedAccount);
  return new NoopSecureStore();
}

export { SERVICE as CREDENTIAL_SERVICE, ACCOUNT as CREDENTIAL_ACCOUNT };
