import { createPlatformSecureStore, SecureKeyStore, SecureKeyStoreUnavailableError } from "./secureStore.js";

export type UpstreamKeySource = "ui-session" | "secure-store" | "environment" | "none";

export interface UpstreamKeyStatus {
  configured: boolean;
  masked: string | null;
  source: UpstreamKeySource;
  secureStoreAvailable: boolean;
  secureStoreLabel: string;
}

/**
 * Single owner of the upstream OpenRouter credential. Every consumer (catalog,
 * endpoint refresh, inference proxy, generation enrichment) resolves the key
 * through this manager at request time, so a key saved from the UI takes
 * effect without a restart. The plaintext never leaves this module.
 *
 * Priority: session key (Remember off / post-save active) > securely persisted
 * key > OPENROUTER_API_KEY from the environment > none.
 */
export class UpstreamCredentialManager {
  private sessionKey: string | null = null;
  private persistedKey: string | null;

  constructor(private readonly environmentKey: string | null, private readonly store: SecureKeyStore = createPlatformSecureStore()) {
    this.persistedKey = readPersistedSafe(store);
  }

  getActiveKey(): string | null {
    return this.sessionKey ?? this.persistedKey ?? this.environmentKey;
  }

  getStatus(): UpstreamKeyStatus {
    const source: UpstreamKeySource = this.sessionKey ? "ui-session" : this.persistedKey ? "secure-store" : this.environmentKey ? "environment" : "none";
    return {
      configured: this.getActiveKey() !== null,
      masked: maskKey(this.getActiveKey()),
      source,
      secureStoreAvailable: this.store.available(),
      secureStoreLabel: this.store.label,
    };
  }

  /** Remember OFF: memory only, gone after a server restart. */
  setSessionKey(key: string): void {
    this.sessionKey = key;
  }

  /** Remember ON: OS credential store. Active key resolves through the persisted layer. Throws on store failure. */
  setPersistedKey(key: string): void {
    this.store.save(key);
    this.persistedKey = key;
  }

  /** Removes UI-managed keys (session + persisted). Falls back to the environment key. */
  clearManagedKey(): void {
    this.sessionKey = null;
    try {
      this.store.clear();
    } finally {
      this.persistedKey = null;
    }
  }
}

function readPersistedSafe(store: SecureKeyStore): string | null {  try {
    return store.load();
  } catch {
    return null;
  }
}

/** "••••abcd" — last four characters only, never a key prefix or full secret. */
export function maskKey(key: string | null): string | null {
  if (!key) return null;
  return `••••${key.slice(-4)}`;
}

export { SecureKeyStoreUnavailableError };
