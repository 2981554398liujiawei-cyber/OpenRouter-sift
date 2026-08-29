# G12 Security Report — OpenRouter Sift

Date: 2026-08-29  
Decision: **V1.0 BLOCKED**

## Threat model

Assets are the OpenRouter upstream API key, `sift_sk_...` Local Access Keys, Desired Model permissions, Provider Filters and access overrides, request metadata, control settings, and OS credential-store contents.

Trust boundaries:

- Browser UI → protected `/api/*` control plane
- AI clients → `/v1/*` inference plane
- Sift → fixed `https://openrouter.ai/api/v1`
- Sift → OS credential store
- Sift → local JSON stores

## Findings

### P0

None found in the inspected tree.

### P1

- `AUD-02`: CI and package metadata were uncommitted at audit time. Release-integrity blocker; resolve by committing and validating the workflow.
- `AUD-03`: README/client verification language, API version example, and release notes were stale. Fixed in this tree by updating README/docs and adding `CHANGELOG.md`; final commit/review remains required.

### P2

- `AUD-04`: debug body logging could preserve prompt/reasoning/tool data. Fixed by shape-only redaction and regression tests.
- `AUD-05`: upstream timeout classification. Fixed to 504/`ERR_UPSTREAM_TIMEOUT`.
- `AUD-06`: security headers on OPTIONS/proxied responses. Fixed by implementation review.
- `AUD-07`: `max_body_bytes` and `request_timeout_ms` lack explicit configuration range validation. Accepted for this release audit as configuration-only risk; follow-up recommended.

### P3

- Cursor is not live-verified.
- Model-detail URL persistence is a known limitation.
- 1440/1024/768 visual sanity remains manual.

## Control plane

Host/DNS-rebinding protection, Origin/CSRF rejection, non-loopback startup refusal without control auth, no wildcard CORS, managed-key rejection from `/api`, in-memory-only browser Control Key, security headers and UI CSP are implemented and covered by `test/control-plane-security.test.ts` plus source review.

## Credentials and privacy

OpenRouter keys resolve through UI session, secure store, environment, or none; plaintext is not returned or stored in normal JSON. Windows Credential Manager uses the credential blob, macOS uses Keychain, and Linux uses Secret Service without plaintext fallback. Local keys use CSPRNG, SHA-256 and timing-safe full-hash comparison. Request records contain metadata only. Prompt, response, reasoning, tool args, auth headers and upstream key material are excluded from persisted records and debug logs.

## Filesystem and routing

Stores use temp-file-plus-rename with restrictive modes where supported. UI serving checks lexical and realpath containment, including symlink escape. Body limits return 413, malformed JSON returns 400, enrichment is bounded, upstream host is fixed, client headers are not forwarded wholesale, and provider restrictions remain fail-closed under stale/unavailable hard-filter metadata.

## Verification

- `npm ci`: PASS
- `npm test -- --run`: **127 passed / 1 skipped**
- `npm run lint`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS
- `npm audit --omit=dev` using official npm registry: **0 vulnerabilities**
- `npm pack --dry-run`: PASS; 10 clean package files
- Tarball install smoke: PASS; installed `/healthz`, `/version`, `/ui/`
- Current-tree secret scan: only synthetic test fixtures matched; no real credential found
- Remote GitHub CI green status, real OpenRouter catalog/models/inference smoke, Windows release smoke, and final 1440/1024/768 visual sanity: NOT EVIDENCED

## Release recommendation

**V1.0 BLOCKED.** The local security and packaging gates are green and no P0 was found. Release labeling is blocked until CI/package/docs changes are committed, remote CI is green, and the remaining real-client/manual release evidence is recorded. No unresolved P1 security vulnerability may be accepted into V1.0.
