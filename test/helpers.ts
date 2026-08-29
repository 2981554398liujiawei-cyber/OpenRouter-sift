import { join } from "node:path";
import { loadConfig, type ShimConfig } from "../src/config";

/**
 * A server config whose every store lives inside `directory`, so tests never
 * read real runtime state from the repository root (metadata cache, desired
 * models, access keys, request logs, settings, policies).
 */
export function isolatedConfig(directory: string, overrides: Partial<ShimConfig> = {}): ShimConfig {
  const cfg = loadConfig({});
  cfg.port = 0;
  cfg.log_level = "silent";
  cfg.model_policy_store_path = join(directory, "policies.json");
  cfg.metadata_cache_path = join(directory, "metadata.json");
  cfg.settings_store_path = join(directory, "settings.json");
  cfg.request_log_store_path = join(directory, "requests.json");
  cfg.desired_model_store_path = join(directory, "desired-models.json");
  cfg.access_key_store_path = join(directory, "access-keys.json");
  return Object.assign(cfg, overrides, {
    model_policy_store_path: overrides.model_policy_store_path ?? cfg.model_policy_store_path,
    metadata_cache_path: overrides.metadata_cache_path ?? cfg.metadata_cache_path,
    settings_store_path: overrides.settings_store_path ?? cfg.settings_store_path,
    request_log_store_path: overrides.request_log_store_path ?? cfg.request_log_store_path,
    desired_model_store_path: overrides.desired_model_store_path ?? cfg.desired_model_store_path,
    access_key_store_path: overrides.access_key_store_path ?? cfg.access_key_store_path,
  });
}
