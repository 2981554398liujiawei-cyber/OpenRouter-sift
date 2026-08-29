# OpenRouter Sift — G13 Search / Provider Console / Bilingual UI

Date: 2026-08-29
Release candidate: `1.0.0-rc.1`
Decision: `V1.0 READY`

## 【G13 Commits】

Search: relevance-ranked All Models search with all-token matching and weighted model-field scoring.
Provider Console: live eligible/excluded endpoint console, filters, metrics, search, quantization, percentiles, sorting, detail expansion, reset/delete/refresh.
i18n: English default with Simplified Chinese switching, persisted locale preference, responsive layouts.
Security: timing-safe local-key comparison, bounded timeout/body settings, collision-resistant atomic store writes.
CI/Packaging: reproducible `prepack`, clean tarball smoke, preferred `openrouter-sift` binary and legacy alias.
Docs: README onboarding/security updates, CHANGELOG, this evidence report.
Seal: implementation commit `f39e523`; remote CI run `33261030017` passed on Ubuntu Node 20/22 and Windows Node 20.

## 【Threat Model】

Assets:

- OpenRouter upstream API key
- Local Access Keys (`sift_sk_`)
- Desired Model permissions and Provider Filters / Access overrides
- Request metadata and control-plane settings
- OS credential store contents

Trust boundaries:

```text
Browser UI       → /api/* control plane
AI clients       → /v1/* inference plane
Sift             → OpenRouter
Sift             → OS credential store
Sift             → local JSON stores
```

Security invariants:

- Local Access Keys cannot control `/api/*`.
- Clients cannot widen Desired Model permissions or Provider sets.
- The OpenRouter key is backend/credential-store only and is never returned to browser plaintext.
- The OpenRouter key is not written to normal JSON stores.
- Local Access Key plaintext is exposed only at creation and only hash/prefix/last4 metadata is persisted.
- Prompt, response, reasoning, tool arguments, and full request bodies are not persisted.
- Inference does not depend on metadata network I/O.
- Hard Provider Filters remain fail-closed when metadata is unavailable, stale, or has zero eligible providers.

## 【Findings】

P0: None found.
P1: None open.
P2: timing-safe local-key comparison and bounds for request timeout/body size fixed.
P3: atomic-write temporary files changed to random exclusive-create files with cleanup on failure.

Accepted risks:

- Cursor remains manual/unverified and is not advertised as verified.
- Model Detail does not persist its state in the URL; no router framework was added.
- Provider availability, rate limits, regional restrictions, and model capability differences remain upstream/environment constraints.
- macOS has platform credential-store logic but no live release runner in this CI matrix.

## 【Control Plane】

Host protection: loopback mode accepts the configured local host forms and rejects untrusted Host values; non-loopback mode requires explicit control authentication.
Origin protection: state-changing `/api/*` browser requests enforce same-origin Origin handling; requests without Origin remain available to CLI/headless clients.
CORS: no wildcard control-plane CORS; inference compatibility is not used to expose the control plane.
`SHIM_LOCAL_API_KEY`: `/ui` and static assets remain loadable; `/api/*` requires the control Bearer key and the UI unlocks it in memory after a 401.
Non-loopback bind: unauthenticated control exposure is refused rather than downgraded to a warning.
Security headers: UI/control responses include nosniff, no-referrer, and frame-denial protections.
Managed key control rejection: `sift_sk_...` is rejected on `/api/*` with `MANAGED_KEY_CONTROL_PLANE_FORBIDDEN`.

## 【Credentials】

OpenRouter key: written only through the backend credential manager; browser receives status, not plaintext.
Local Access Keys: cryptographically random, hash-only persistence, timing-safe hash comparison, and exact-key verification rather than prefix/last4 authorization.
Control key: in-memory browser state only; not placed in URL, localStorage, or cookies.
Credential store: secure OS store path is preferred; unavailable secure storage does not fall back to plaintext JSON.
Rotation: replacing key A with B uses B for new requests while already-started requests may finish with A.
Persistence: normal JSON stores contain no upstream secret; key metadata contains hash/display metadata only.

## 【Privacy】

Prompt: G13 sentinel/request privacy checks pass; prompt content is not persisted.
Response: response sentinel is not persisted.
Reasoning: not persisted.
Tool args: not persisted.
Errors: upstream/auth details are sanitized before request records.
Logs: secret-pattern scan found no real credentials or auth headers in tracked files or runtime logs.

## 【Filesystem】

Atomic writes: random exclusive temporary files, rename, and failed-write cleanup; no easy partial JSON write path.
Permissions: platform-appropriate private storage is retained; Unix private-file behavior is covered by the existing storage implementation.
Path traversal: static UI path handling rejects traversal and encoded traversal forms; model IDs are encoded as path data.
Runtime files: stores, temporary files, QA data, screenshots, logs, and tarballs are excluded from the release package and are not tracked.

## 【Routing Security】

Desired permission: client requests are constrained by current Desired Model policy.
Hard Filter: provider rules are rechecked server-side and can only reduce the provider set.
Key Override: overrides cannot widen the hard boundary.
Incoming restriction: incoming-only and ignore-incoming modes retain their intended restrictions.
Fail closed: unavailable/stale metadata and zero eligible providers reject rather than silently widening routing.

## 【Network】

SSRF: upstream host is fixed to `https://openrouter.ai`; model IDs cannot become arbitrary URLs.
Header forwarding: local access/control credentials are not forwarded upstream; active OpenRouter authorization replaces them.
Body limits: control and inference JSON bodies are bounded and oversized requests return 413.
Timeout/retry: request timeout and retry bounds are enforced; 400/401/403 responses are not treated as long retry candidates.
Cancellation: client aborts stop pending retry/backoff work where supported by the request path.

## 【Dependencies】

`npm audit --omit=dev`: PASS, 0 vulnerabilities using the official npm registry.
Runtime findings: none.
Dev findings: none reported; no large framework was added.

## 【CI】

OS: Ubuntu and Windows jobs are defined; Ubuntu is the Linux release gate.
Node versions: Ubuntu Node 20, Ubuntu Node 22, Windows Node 20; package engines are truthful for the tested release range.
Tests: `npm ci`, `npm test -- --run`, `npm run lint`, `npm run build`, audit, package dry-run, and package smoke are in the workflow.
Lint: included in every matrix job.
Build: included in every matrix job.
Remote result: PASS — GitHub Actions run `33261030017`; Ubuntu Node 20, Ubuntu Node 22, and Windows Node 20 all passed every configured step.

## 【Packaging】

`npm pack`: PASS; `prepack` rebuilds the release before packing.
Tarball contents: exactly the intended CHANGELOG, LICENSE, README, package metadata, server bundle, and UI bundle; no source, tests, stores, screenshots, logs, or QA data.
Clean install: PASS in a new temporary install.
UI assets: installed package serves `/ui` with HTTP 200.
CLI: `openrouter-sift` is the preferred binary; `openrouter-provider-shim` remains as a compatibility alias.
Version: installed `/version` reports product `OpenRouter Sift`, version `1.0.0-rc.1`.

## 【Compatibility】

Existing stores: G11 metadata, desired, keys, settings, policies, and requests remain readable; corrupt-store handling remains non-crashing.
Existing env config: retained, with UI secure-store onboarding recommended for ordinary users.
Windows: installed RC real smoke passed on the primary Windows environment.
Linux: covered by Ubuntu CI.
macOS: credential-store platform logic remains covered by tests; no live runner claim.

## 【Docs】

Quick Start: starts with `/ui` → Settings → OpenRouter key → Desired Models → Local Access Key.
OpenRouter key UI: write-only, OS credential store when remembered, session-only otherwise, never returned to browser plaintext.
Codex: verified in G11 and carried into release documentation.
Claude Code: verified in G11; user-level `~/.claude/settings.json` override caveat documented.
OpenCode: verified in G11; `provider/model` and `opencode.json` registration documented.
Security: control/inference boundary, credential roles, and non-loopback behavior documented.
Privacy: request-content persistence and logging boundaries documented.
CHANGELOG: includes the `1.0.0-rc.1` G13 closure entry.

## 【Manual】

Cursor: intentionally manual/unverified; README does not claim verification.
1440: English and Simplified Chinese pages checked; no page overflow.
1024: English and Simplified Chinese pages checked; no page overflow.
768: English and Simplified Chinese pages checked; no page overflow; provider table uses contained horizontal scrolling as designed.
Checked surfaces: All Models, Desired Models, Provider Console, API Keys, Requests, and Settings.
Real installed RC UI: Requests showed a real short inference record with HTTP 200 and no console errors/warnings.

## 【Final Gates】

Tests: PASS — 131 passed, 1 skipped.
Lint: PASS.
Build: PASS.
Diff-check: PASS.  
Secret scan: PASS — no real secret found; synthetic fixtures are limited to tests.
Runtime artifact scan: PASS — no tracked runtime stores, logs, screenshots, source maps, or tarballs.
Release smoke: PASS — installed RC `/healthz`, `/version`, `/ui`, catalog refresh, `/v1/models`, one real short inference, and Requests record.
Worktree: clean after the report seal commit.

## 【Known Issues】

- Cursor has not been live-tested and is documented as manual/unverified.
- Some OpenRouter providers may be unavailable due to upstream rate limits, regional restrictions, or model capability differences.
- Model Detail state is not persisted in the URL.
- macOS has no live runner in the release CI matrix.

## 【Release Decision】

`V1.0 READY`
