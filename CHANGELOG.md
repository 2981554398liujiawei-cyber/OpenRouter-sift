# Changelog

## G15 — secure key vault and Windows launcher

- Local Access Keys created by the new build are recoverable after restart through the OS credential store; normal JSON stores still contain only hashes and display metadata.
- Added an authenticated, no-store copy-secret endpoint with hash verification, legacy-key detection, one-time fallback when secure storage is unavailable, and cleanup on deletion.
- Added `openrouter-sift launch` for a loopback-only Windows session with a browser-tab lease, hidden startup, bounded port selection, and fixed desktop shortcut create/remove controls.
- Added the OpenRouter Sift SVG/PNG/ICO icon set and included release assets in the package allowlist.
- Added G15 vault/lease regression tests and updated the UI and security documentation.

## G14 — reliability and release closure

- Numeric Provider Filter and Settings editors now preserve intermediate values such as `0.` and `0.01` until preview/save parsing.
- Local Access Key creation has explicit validation, single-flight submission, inline failure feedback, and persistence rollback safety.
- Native OpenRouter `session_id` / `x-session-id` passthrough is covered for Chat Completions, Responses, Messages, and streaming responses without storing session values.
- Requests expose cache status, age, cached input tokens, cache writes, discount, and cache ratio when safe metadata is available; prompt and response content remains non-persistent.
- Added the G14 engineering audit and release evidence for CI, package contents, tarball installation, and compatibility boundaries.

## 1.0.0-rc.1 — release candidate

### G13 closure

- Added relevance-ranked All Models search across names, IDs, creators, and descriptions.
- Reworked Desired Model detail into a Provider Console with server-evaluated eligible/excluded rows, provider diagnostics, and UI-only comparison controls.
- Added English / Simplified Chinese switching with responsive layouts and truthful client/setup documentation.
- Added reproducible package prepacking and clean tarball install smoke coverage.

### Core features

- Local OpenRouter gateway for Anthropic Messages, Chat Completions, and Responses APIs.
- Browser control plane for model catalog, Desired Models, provider filters, Local Access Keys, and metadata-only request history.
- Server-side model/provider policy enforcement with fail-closed hard filters.

### Security model

- OpenRouter credentials stay in the backend, OS credential store, session memory, or environment; they are never returned to the browser or written to normal JSON stores.
- Local Access Keys are inference-only, shown once, and stored as SHA-256 hashes.
- Control-plane authentication, localhost Host/Origin protection, bounded request bodies, atomic stores, and redacted logging are covered by G12 security tests.

### Supported protocols and verified clients

- Supported protocols: Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses.
- Verified harnesses: Codex, Claude Code, and OpenCode.
- Cursor remains manual/unverified.

### Known limitations

- OpenRouter rate limits, provider availability, and regional restrictions remain upstream/environment constraints.
- Generation enrichment is best-effort and may remain Unknown when OpenRouter metadata is unavailable.
- Model detail state is not persisted in the URL.
