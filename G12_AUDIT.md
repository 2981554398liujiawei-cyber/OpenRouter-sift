# G12 Audit — Security / Release Readiness

Date: 2026-08-29
Audit target: working tree based on `3e22cdc` plus the uncommitted package/CI changes. The user-supplied `9c14b6c` baseline does not match this checkout, so conclusions use the inspected tree.

Severity: P0 = secret disclosure, authorization bypass, provider-boundary bypass, or remote control; P1 = release/security blocker; P2 = important but not core-security blocking; P3 = polish/maintenance.

## Audit-first findings

### P0

None found in the inspected implementation.

### P1

| ID | Surface | Evidence | Status |
|---|---|---|---|
| AUD-01 | Dependency audit | The configured mirror returned HTTP 404 / `NOT_IMPLEMENTED`; rerun against `https://registry.npmjs.org` completed successfully with 0 vulnerabilities. | Resolved for this audit; CI should use a working registry. |
| AUD-02 | Release evidence | `.github/workflows/ci.yml` and package metadata are now committed locally, but this checkout has no reachable `origin/main` and no remote CI result is available. | Open until CI is observed green on the published commit. |
| AUD-03 | Documentation | README still labels client setup “carried over, not re-verified”; `CHANGELOG.md` is absent; `docs/api.md` says `1.0.0` while package version is `0.1.0`. | Open until documentation is truthful and release notes are added. |

### P2

| ID | Surface | Evidence | Status |
|---|---|---|---|
| AUD-04 | Debug logging | Raw request/response body logging was possible with `redact_body=false`; working tree now always logs redacted shapes and removes content fields. | Fixed; regression added in `test/security.test.ts`. |
| AUD-05 | Timeout reporting | Upstream timeout was reported as generic 502; working tree now returns 504 with `ERR_UPSTREAM_TIMEOUT`. | Fixed; targeted regression still required. |
| AUD-06 | Response headers | `OPTIONS` and proxied responses lacked common security headers; working tree now applies them. | Fixed; targeted header regression still required. |
| AUD-07 | Config bounds | `max_body_bytes` and `request_timeout_ms` accept values without explicit positive/range validation. | Open; configuration-only risk. |

### P3

- Cursor has not been live-tested and must not be described as verified.
- Visual sanity at 1440/1024/768 and real client smoke remain manual release gates.
- Model-detail persistence in the URL remains a known limitation unless a low-risk fix is chosen without adding a router framework.

## Threat model

### Assets

- OpenRouter upstream API key
- Local Access Keys (`sift_sk_...`)
- Desired Model permissions
- Provider Filters and access-key provider overrides
- Request metadata and control-plane settings
- OS credential store contents

### Trust boundaries

`Browser UI → /api/*` (control plane)
`AI clients → /v1/*` (inference plane)
`Sift → https://openrouter.ai/api/v1`
`Sift → OS credential store`
`Sift → local JSON stores`

### Security invariants and evidence

| Invariant | Evidence / result |
|---|---|
| Local Access Key cannot control `/api` | Managed-key gate and control-plane tests pass. |
| Client cannot widen Desired Model or Provider permissions | Policy, managed-routing, provider-filter and protocol tests pass. |
| OpenRouter key never reaches browser plaintext | `/config` and status return no plaintext; Settings UI uses masked status. |
| OpenRouter key never enters normal JSON stores | Credential manager uses secure store/session/env; stores contain no upstream credential field. |
| Local Access Key plaintext is one-time | Creation returns secret once; persisted record stores SHA-256 hash, prefix and last4 only. |
| Prompt/response/reasoning/tool args are not persisted | Request records contain metadata only; privacy/observability tests pass; debug logging now redacts content. |
| Inference does not depend on metadata network I/O | Preview/parity tests pass; hard filters fail closed when metadata is unavailable. |
| Hard Filter unavailable/stale remains fail-closed | Provider filter API and preview parity tests pass. |

## Control plane

- Host/DNS rebinding: loopback binds accept only `localhost`, `127.0.0.1`, `[::1]`; foreign Host is 403 (`src/util/hostGuard.ts`, `test/control-plane-security.test.ts`).
- Origin/CSRF: foreign Origins are rejected for loopback requests; no-Origin CLI clients remain supported.
- CORS: no wildcard grant; loopback preflight only; security headers apply to OPTIONS.
- Non-loopback bind: startup refuses without `SHIM_LOCAL_API_KEY`/local API key.
- `SHIM_LOCAL_API_KEY`: `/ui` and static assets load without auth; `/api/*` requires control Bearer; UI key is in-memory only and clears on refresh.
- Managed-key control rejection: `MANAGED_KEY_CONTROL_PLANE_FORBIDDEN` is covered by regression tests.
- Security headers/CSP: `nosniff`, `no-referrer`, `X-Frame-Options: DENY`; UI HTML has same-origin CSP with `frame-ancestors 'none'`.
- XSS: production source has no `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval`, or `new Function`; values render as text.
- Static path traversal: URL decoding, lexical containment, realpath containment, backslash/NUL rejection and symlink escape checks are present.

## Credentials and privacy

- Secure storage: Windows Credential Manager, macOS Keychain, Linux Secret Service; unavailable storage does not fall back to plaintext JSON.
- Priority: UI session → secure store → environment → none.
- Rotation: manager resolves the active key per request; replaced key applies to new requests while already-started requests continue.
- Local keys: CSPRNG (`randomBytes(32)`), SHA-256, `timingSafeEqual`, full hash verification rather than prefix/last4 lookup.
- Logs: auth is represented by scheme/length only; body debug paths redact secret fields and content even when `redact_body=false`; error responses/logs use sanitized upstream messages.

## Filesystem and runtime

- Stores use sibling temp write + rename and restrictive mode `0600`; parent directories are created with `0700` where supported. Windows relies on user ACLs.
- Runtime JSON, `.tmp`, logs and QA material are ignored; package allowlist is `files: ["dist"]`.
- Corrupt metadata/request/desired stores are handled without crashing; fresh and G11 upgrade persistence tests pass.
- Request body limits return 413; malformed JSON returns 400.
- Enrichment is bounded at queue 100/concurrency 2; desired endpoint refresh uses concurrency 2 and one replaceable timer.

## Routing and network

- Upstream host is fixed to `https://openrouter.ai/api/v1`; model IDs are encoded path segments.
- Client headers are not forwarded wholesale; only explicit authorization/content-type and configured attribution headers are sent upstream.
- Hop-by-hop and unrelated response headers are not copied; only content type, cache, request-id and retry-after are returned.
- Claude retry is bounded to eight 429 retries and abort cancels backoff. Timeout reports 504/`ERR_UPSTREAM_TIMEOUT`.
- Hard Filter, Key Override, Model Policy and incoming restrictions are covered by existing G8–G11 regressions; no widening path was found.

## Current gates

- `npm test -- --run`: **126 passed / 1 skipped**
- `npm run lint`: **PASS**
- `npm run build`: **PASS**
- `git diff --check`: **PASS**
- `npm pack --dry-run`: **PASS**; 10 files, only `dist`, README, LICENSE and package metadata.
- `npm audit --omit=dev`: **PASS** against `https://registry.npmjs.org` (0 vulnerabilities); the configured mirror remains incompatible with npm audit.
- `npm ci`: **PASS**.
- Tarball clean-install smoke: **PASS** (`/healthz 200`, `/version` 0.1.0, `/ui/ 200`; installed UI asset present).
- Real catalog/models/inference smoke, Windows release smoke, and 1440/1024/768 visual sanity: **not yet evidenced**.
- CI run `33250965870` exposed Node 18 timing failures in existing long-running restart/cleanup tests; Node 20/22 Ubuntu and Node 20 Windows passed. The supported engine is therefore now truthfully `>=20.0.0`, and Node 18 is no longer claimed.

## Release recommendation

**V1.0 BLOCKED.** No open P0 was found and the runtime audit gates pass locally, but remote CI status is not evidenced and real-client/manual visual gates remain incomplete. Do not label this tree `V1.0 READY` until those gates pass.
