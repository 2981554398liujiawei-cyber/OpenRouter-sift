# Changelog

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
