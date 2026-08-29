# OpenRouter Sift

Local gateway between AI coding tools (Claude Code, Codex CLI, OpenCode, …) and OpenRouter. It enforces Desired-Model permissions and provider-routing policy server-side, issues scoped **Local Access Keys** for `/v1/*`, and ships a browser control plane at `/ui`.

The npm package name is still `openrouter-provider-shim` (release packaging is deferred); the commands in [Quick Start](#quick-start) use a checkout directly.

```
OpenRouter
   ↓
OpenRouter Sift   (local gateway + control UI at /ui)
   ↓
Local Access Keys (sift_sk_…, scoped per key)
   ↓
Codex / Claude Code / OpenCode / any OpenAI- or Anthropic-compatible client
```

## Core Concepts

| Concept | Meaning |
|---|---|
| **All Models** | The full OpenRouter catalog, browsable and searchable from the control UI. |
| **Desired Models** | The subset you actually route through Sift. Inference is fail-closed to this set. |
| **Provider Filters** | Per-Desired-Model hard rules (routing ID, price, quantization, telemetry) evaluated against live endpoint snapshots. |
| **API Keys** | Local Access Keys (`sift_sk_…`) that clients use; each key only reaches its assigned Desired Models. |
| **Provider Access** | Per-key allowlist/blocklist/order overrides layered on top of the model's own routing policy. |
| **Requests** | Metadata-only request history: routing decision trace, status, latency, enriched usage/cost when OpenRouter provides it. |

## Why this shim exists

Some AI agent harnesses can point at an OpenAI-compatible base URL, but they cannot attach OpenRouter's per-request `provider` routing object. This includes Claude Code, which uses the Anthropic Messages API and has no way to specify provider preferences.

OpenRouter supports a `provider` object for routing preferences including `only`, `order`, `ignore`, `sort` (price, throughput, latency), performance thresholds, and max price. This shim injects these fields server-side, so end users do not need OpenRouter account-wide settings.

**Note:** Tools like OpenCode and OpenHands have native OpenRouter provider configuration and don't need this shim. See [When You DON'T Need This Shim](#when-you-dont-need-this-shim) below.

## Features

- **Multi-protocol support**: Anthropic Messages API, OpenAI Chat Completions, and OpenAI Responses API
- **Provider routing enforcement**: Merge, override, or strict modes for provider policies
- **Flexible authentication**: Passthrough or upstream-key auth modes
- **Local control UI**: Models, endpoints, policies, preview, and settings at `/ui`
- **Privacy-first logging**: Logs metadata only, never prompt content
- **Cross-platform**: Works on macOS, Linux, and Windows

## Quick Start

Verified against a clean checkout:

```bash
npm install
npm run build
npm start   # serves http://127.0.0.1:8787
```

Then:

1. Open [http://127.0.0.1:8787/ui](http://127.0.0.1:8787/ui).
2. Go to **Settings → OpenRouter**, paste your OpenRouter API key, and click **Save Key**. Sift verifies the key against OpenRouter before storing it; "Remember on this device" keeps it in the OS credential store, unchecking it keeps it for the current session only.
3. Add a model to **Desired Models**, create an **API Key** for it, and point your client at `http://127.0.0.1:8787/v1` with the `sift_sk_…` key.

The model catalog uses OpenRouter's public API, so browsing works before a key is configured; inference requires the key.

Minimal smoke test once a key exists (use your own key; it is shown only once at creation):

```bash
curl http://127.0.0.1:8787/v1/models -H "Authorization: Bearer sift_sk_YOUR_KEY"

curl http://127.0.0.1:8787/v1/chat/completions -H "Authorization: Bearer sift_sk_YOUR_KEY" -H "Content-Type: application/json" -d '{"model":"<a-desired-model-id>","max_tokens":16,"messages":[{"role":"user","content":"Reply only: OK"}]}'
```

### Headless / advanced configuration

Servers, CI, and automation can skip the UI and set `OPENROUTER_API_KEY` in the environment at startup. The Settings UI still works alongside it: a key saved from the UI takes priority until forgotten, after which Sift falls back to the environment variable.

## Security

- **Local by default.** The server binds `127.0.0.1`; do not expose it to a network without understanding the consequences.
- **The backend owns the upstream secret.** The browser may submit an OpenRouter key to the localhost backend, but the backend never returns the plaintext — responses carry a `••••abcd`-style mask and the source ("secure-store", "ui-session", "environment"). "Remember" writes to the OS credential store (Windows Credential Manager / macOS Keychain / Secret Service); session-only keys live in server memory and disappear on restart. Nothing is ever written as plaintext to the JSON stores.
- **Local key plaintext is one-time.** `sift_sk_…` is displayed once at creation; disk stores a SHA-256 digest, key prefix, and last four characters.
- **Managed keys are inference-only.** A `sift_sk_…` key is rejected on `/api/*` and `/ui/*` with `MANAGED_KEY_CONTROL_PLANE_FORBIDDEN`.
- **Environment keys remain supported.** `OPENROUTER_API_KEY` is the headless fallback: UI-configured keys override it at runtime, and forgetting them restores it.
- **Control-plane authentication is opt-in.** Without `SHIM_LOCAL_API_KEY`, `/api/*` and `/ui` are open to local processes (localhost trust). When `SHIM_LOCAL_API_KEY` is set, both the management API *and* the static `/ui` page require its `Bearer` header — a plain browser cannot open the UI in that mode, so the setting targets headless/unattended deployments.

## Privacy

Request records are metadata-only. Sift never persists prompts, responses, reasoning, or tool arguments, and upstream error bodies are stored only as sanitized summaries. The OpenRouter upstream key and Local Access Key plaintext never appear in logs, the request store, or the metadata cache.

## Client Notes (carried over, not re-verified with live inference in this stage)

The setups below come from earlier project stages. They describe the intended wiring, but the live harness smoke tests for this stage are still pending — treat them as guidance, not verified instructions.

### Claude Code

**Automatic key substitution**

If you have both `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` set, the shim will automatically detect and substitute your Anthropic key with your OpenRouter key:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
export ANTHROPIC_MODEL="moonshotai/kimi-k2.5"
npx openrouter-provider-shim serve --port 8787 --provider-only fireworks --sort throughput --no-fallbacks &

export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
claude
```


### Rate limiting notes

**Rate limiting:** The shim includes automatic retry with custom backoff delays for Claude Code (detected by its use of the Anthropic Messages API). Retries use delays: 1s, 2s, 4s, 8s, 12s, 18s, 24s, 32s. If you hit rate limits:
- Add your own Fireworks API key to OpenRouter (BYOK) at https://openrouter.ai/settings/integrations
- Use the `--provider-order` option to allow fallback providers
- Wait a moment between requests and manually retry or prompt "Continue"

### When You DON'T Need This Shim

Some AI tools have **native OpenRouter provider routing support** and don't need this shim:

**OpenCode** - Has built-in OpenRouter provider configuration. In `~/.config/opencode/opencode.json`:
```json
{
  "provider": {
    "openrouter": {
      "models": {
        "moonshotai/kimi-k2.5": {
          "options": {
            "provider": {
              "order": ["fireworks"],
              "allow_fallbacks": false
            }
          }
        }
      }
    }
  }
}
```

**OpenHands** - Uses LiteLLM in-process and supports provider routing via `LLM_LITELLM_EXTRA_BODY`:
```bash
export LLM_LITELLM_EXTRA_BODY='{"provider":{"order":["fireworks"],"allow_fallbacks":false}}'
export LLM_API_KEY="$OPENROUTER_API_KEY"
export LLM_MODEL="openrouter/moonshotai/kimi-k2.5"
openhands --override-with-envs
```

### When You DO Need This Shim

Use this shim for tools that **cannot** configure OpenRouter's per-request provider routing:

#### Claude Code (Primary Use Case)
Uses Anthropic Messages API - cannot set OpenRouter provider routing. This is the primary use case for this shim.

```bash
export OPENROUTER_API_KEY="your-api-key"
npx openrouter-provider-shim serve --port 8787 --provider-only fireworks

export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_MODEL="moonshotai/kimi-k2.5"
claude
```

#### Droid (Factory) - When Tool Calls Fail

Droid supports OpenRouter via `generic-chat-completion-api`, but tool calls may not work reliably with native OpenRouter integration. If they ever address this, you should be able to simply configure a custom model with OpenRouter provider settings like this:
```json
{
  "model": "moonshotai/kimi-k2.5",
  "id": "custom:Kimi-K2.5-[OR-->-Fireworks]-2",
  "index": 2,
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKey": "sk-or-v1-REDACTED",
  "displayName": "Kimi K2.5 [OR -> Fireworks]",
  "maxOutputTokens": 131072,
  "extraArgs": {
    "provider": {
      "order": [
        "fireworks"
      ],
      "allow_fallbacks": false
    }
  },
  "noImageSupport": false,
  "provider": "generic-chat-completion-api"
}
```

For the time being, however, testing has shown tool calls to fail with the above setup, however. Use this shim for better compatibility.

**1. Start the shim:**
```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
npx openrouter-provider-shim serve --port 8787 --provider-only fireworks
```

**2. Add to `~/.factory/settings.json` in the `customModels` array:**
```json
{
  "model": "moonshotai/kimi-k2.5",
  "id": "custom:Kimi-K2.5-[shim-->-Fireworks]-2",
  "index": 2,
  "baseUrl": "http://127.0.0.1:8787/v1",
  "apiKey": "sk-or-v1-REDACTED",
  "displayName": "Kimi K2.5 [shim -> Fireworks]",
  "maxOutputTokens": 131072,
  "noImageSupport": false,
  "provider": "generic-chat-completion-api"
}
```


## CLI Commands

### `serve` (default)

Starts the local shim server.

```bash
npx openrouter-provider-shim serve \
  --port 8787 \
  --provider-only fireworks \
  --sort throughput \
  --no-fallbacks \
  --auth-mode passthrough
```

### `doctor`

Validates config and checks connectivity to OpenRouter.

```bash
npx openrouter-provider-shim doctor --provider-only fireworks
```

### `print-env`

Prints copy-paste environment variables for Claude Code and OpenAI clients.

```bash
npx openrouter-provider-shim print-env --port 8787
```

## Configuration

Configuration can be provided via:
1. CLI flags (highest priority)
2. Environment variables
3. Config file (lowest priority)

### Authentication

The shim supports several authentication modes:

**passthrough mode (default)**
- Forwards the `Authorization` header from the inbound request to OpenRouter
- **Smart substitution**: If the inbound auth looks like an Anthropic API key (starts with `sk-ant-`) and you have `OPENROUTER_API_KEY` set, the shim automatically substitutes it with your OpenRouter key
- This allows you to keep `ANTHROPIC_API_KEY` set for other tools while using OpenRouter via the shim

**upstream-key mode**
- Always uses the configured OpenRouter API key, ignoring inbound auth
- Useful when you don't want clients to know the OpenRouter key

```bash
# Default passthrough with smart substitution
npx openrouter-provider-shim serve --port 8787

# Explicit upstream key (never use inbound auth)
npx openrouter-provider-shim serve --port 8787 --auth-mode upstream-key --upstream-key "sk-or-v1-..."
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to config JSON file |
| `--host <host>` | Host to bind (default: 127.0.0.1) |
| `--port <port>` | Port to bind (default: 8787) |
| `--merge-mode <mode>` | Provider merge mode: merge, override, strict |
| `--provider-only <list>` | Comma-separated list of allowed providers |
| `--provider-order <list>` | Comma-separated provider priority order |
| `--provider-ignore <list>` | Comma-separated list of providers to skip |
| `--sort <sort>` | Sort by: price, throughput, latency |
| `--no-fallbacks` | Disable fallback providers |
| `--require-parameters` | Require providers to support all parameters |
| `--data-collection <allow\|deny>` | Data collection policy |
| `--zdr` | Enforce Zero Data Retention |
| `--quantizations <list>` | Comma-separated quantization list |
| `--auth-mode <mode>` | passthrough or upstream-key |
| `--upstream-key <key>` | OpenRouter API key |
| `--local-api-key <key>` | Local authentication key |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key |
| `SHIM_HOST` | Host to bind |
| `SHIM_PORT` | Port to bind |
| `SHIM_AUTH_MODE` | passthrough or upstream-key |
| `SHIM_LOCAL_API_KEY` | Local authentication key |
| `SHIM_MERGE_MODE` | merge, override, or strict |
| `SHIM_PROVIDER_ONLY` | Comma-separated allowed providers |
| `SHIM_PROVIDER_ORDER` | Comma-separated provider order |
| `SHIM_PROVIDER_IGNORE` | Comma-separated ignored providers |
| `SHIM_PROVIDER_SORT` | price, throughput, or latency |
| `SHIM_PROVIDER_ALLOW_FALLBACKS` | true or false |
| `SHIM_PROVIDER_REQUIRE_PARAMETERS` | true or false |
| `SHIM_PROVIDER_DATA_COLLECTION` | allow or deny |
| `SHIM_PROVIDER_ZDR` | true or false |
| `SHIM_PROVIDER_QUANTIZATIONS` | Comma-separated quantizations |
| `SHIM_PROVIDER_PREFERRED_MIN_THROUGHPUT` | Number or JSON thresholds |
| `SHIM_PROVIDER_PREFERRED_MAX_LATENCY` | Number or JSON thresholds |
| `SHIM_PROVIDER_MAX_PRICE` | JSON: `{"prompt":1.0,"completion":4.0}` |

### Config File

Create a `shim-config.json`:

```json
{
  "host": "127.0.0.1",
  "port": 8787,
  "merge_mode": "merge",
  "policy": {
    "only": ["fireworks"],
    "sort": "throughput",
    "allow_fallbacks": false
  },
  "auth_mode": "passthrough",
  "log_level": "info"
}
```

Run with: `npx openrouter-provider-shim serve --config shim-config.json`

### Per-model policies (G1)

G1 adds a local, persisted policy store. By default it is `openrouter-control-policies.json` in the current directory; set a different location with `--policy-store <path>` or `SHIM_MODEL_POLICY_STORE_PATH`.

```json
{
  "version": 1,
  "models": {
    "deepseek/example": {
      "mode": "allowlist",
      "providers": ["relace", "gmicloud"],
      "provider_order": ["relace", "gmicloud"],
      "allow_fallbacks": false
    }
  }
}
```

`inherit` (or a missing model entry) uses the configured global `policy`; `allowlist` compiles to `provider.only`; `blocklist` compiles to `provider.ignore`; and `custom` accepts a validated OpenRouter provider policy. The `/ui` editor is the preferred way to manage these entries. Do not place API keys, prompts, or responses in this file.

### OpenRouter metadata catalog (G2)

The proxy caches the model directory in `openrouter-control-metadata.json` (change it with `--metadata-cache <path>` or `SHIM_METADATA_CACHE_PATH`). Metadata refresh is independent of model calls: a failed refresh preserves the most recent snapshot and returns `stale` rather than replacing it with an empty list.

| Endpoint | Purpose |
|---|---|
| `GET /api/models` | Read or refresh the model catalog when its five-minute cache is stale |
| `POST /api/models/refresh` | Force a model catalog refresh |
| `GET /api/models/:modelId/endpoints` | Lazy-load cached provider endpoints for one model |
| `POST /api/models/:modelId/endpoints/refresh` | Force endpoint refresh |

The API returns a stable DTO and does not expose cached raw metadata. Provider display names and OpenRouter routing identifiers are separate fields; no identifier is derived from display text.

### Control UI and management API (G3/G4)

The same local server serves the React control interface at `/ui` and management API at `/api/*`; neither affects proxy routes under `/v1/*`. The Models view searches the local catalog, loads endpoint metadata on demand, and shows unavailable OpenRouter metrics as `—`. The policy editor uses a server-side preview, so the displayed provider JSON is compiled by the same resolver that handles proxy traffic.

The UI supports `inherit`, allowlist, and blocklist policies. Allowlist ordering uses the verified `providerRoutingId` from endpoint metadata, and an empty allowlist cannot be saved. The Policies page can reset an entry by deleting the model-specific policy, returning it to global/inherit behavior.

Settings persist merge mode, global policy, and metadata cache TTL. The configured API-key state is display-only: runtime key updates are deliberately rejected, so use environment variables or startup options instead.

### Request observability (G5)

The Requests page at `/ui` records local request metadata only: protocol, requested and forwarded model, policy snapshot, status, duration, cancellation, and the OpenRouter generation ID. Prompts, responses, tool arguments, and authorization values are never persisted or exposed through the management API.

When a persistent `OPENROUTER_API_KEY` is configured and OpenRouter provides `X-Generation-Id`, the proxy schedules a separate, bounded `GET /api/v1/generation?id=...` lookup after the client response completes. This enriches the record with the confirmed provider name, usage, actual cost, and OpenRouter timing. The proxy never injects `X-OpenRouter-Metadata`, never calls `/generation/content`, and never waits for enrichment before completing a request.

Request history is JSON metadata with a default retention of 1000 records. Change its location with `--request-log-store <path>` or `SHIM_REQUEST_LOG_STORE_PATH`; adjust the retention (100–10000) in Settings. `GET /api/requests`, `GET /api/requests/:id`, and `DELETE /api/requests` are local-only management endpoints.

### Managed Local Access Keys and Desired Models (G6)

The control UI now separates the persistent **Upstream OpenRouter API Key** (configured outside the browser) from **Local Access Keys** (`sift_sk_...`) for clients. Add models to Desired Models first, then issue each Local Access Key only the selected subset. A managed key is valid exclusively on `/v1/*`; it cannot access `/api/*` or `/ui/*`.

Managed `/v1/models` returns only `Desired Models ∩ allowedModels`. The same rule is enforced after any Anthropic model remap for Messages, Chat Completions, and Responses calls, so client aliases cannot bypass an allowed-model assignment. Removing a Desired Model removes it from managed keys and immediately makes it unavailable.

Local Access Key plaintext is returned only by `POST /api/access-keys`; disk stores a SHA-256 digest, safe prefix, and last four characters. Default JSON paths are `openrouter-control-desired-models.json` and `openrouter-control-access-keys.json`, configurable with `--desired-model-store` / `SHIM_DESIRED_MODEL_STORE_PATH` and `--access-key-store` / `SHIM_ACCESS_KEY_STORE_PATH`.

## Merge Modes

### merge (default)
- If request has no `provider`, inject the configured policy
- If request has `provider`, merge missing fields from policy without overriding

### override
- Replace request `provider` entirely with policy `provider` (hard enforcement)

### strict
- If request `provider` exists and differs from policy for any enforced fields, reject with HTTP 422
- Useful for regulated enterprise policies

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/messages` | Anthropic Messages API |
| `POST /v1/chat/completions` | OpenAI Chat Completions API |
| `POST /v1/responses` | OpenAI Responses API |
| `GET /v1/models` | List available models (pass-through) |
| `GET /healthz` | Health check |
| `GET /version` | Version information |
| `GET /config` | Current configuration (sanitized) |

## Testing

```bash
# Chat Completions
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "moonshotai/kimi-k2.5",
    "messages": [{"role":"user","content":"Say hello"}],
    "stream": false
  }'

# Anthropic Messages
curl http://127.0.0.1:8787/v1/messages \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "moonshotai/kimi-k2.5",
    "max_tokens": 256,
    "messages": [{"role":"user","content":"Hello from anthropic messages"}]
  }'

# Responses API
curl http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "moonshotai/kimi-k2.5",
    "input": "Hello from responses"
  }'
```

## Known Limitations

- Live harness smoke tests for Codex, Claude Code, and OpenCode (and Cursor) were not re-verified against real OpenRouter inference at this stage; the client notes above are carried over from earlier project stages.
- "Actual provider", token usage, and cost appear on a request only after OpenRouter's generation-metadata enrichment completes; without it the field reports Unknown and inference is unaffected.
- Setting `SHIM_LOCAL_API_KEY` blocks plain-browser access to `/ui` (see Security).
- Request history is a JSON file with a default retention of 1000 records; there is no database backend.

## License

MIT
