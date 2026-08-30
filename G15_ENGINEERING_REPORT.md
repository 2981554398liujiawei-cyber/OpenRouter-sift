# OpenRouter Sift — G15 Engineering Report

Status: implementation and release-gate audit in progress; this document records the evidence boundary and is not a release claim by itself.

## Scope

G15 is limited to secure Local Access Key recovery, the Windows one-click launcher, packaging assets, UI wording, regression coverage, and release documentation. No quota, billing, database, multi-user, cloud, OAuth, or model-chain features were added.

## Threat model

Assets: the OpenRouter upstream API key, `sift_sk_` Local Access Keys, desired-model permissions, provider filters and overrides, request metadata, control-plane settings, the OS credential store, and local JSON stores.

Trust boundaries:

```text
Browser UI → /api/* control plane
AI clients → /v1/* inference plane
Sift → OpenRouter
Sift → OS credential store
Sift → local JSON stores
```

Security invariants:

- A Local Access Key is accepted only on `/v1/*`; it cannot authenticate `/api/*`.
- Client input can only narrow Desired Models and provider eligibility.
- The OpenRouter key is backend-only and is not returned by `/api/settings`.
- Local Access Key JSON contains no plaintext secret; the secret is either in an OS credential slot or is explicitly one-time/unavailable.
- Prompt, response, reasoning, tool arguments, and client session values are not persisted.
- Secret retrieval requires control-plane authorization, exact key id lookup, OS-store retrieval, and SHA-256 verification.
- Deleting the JSON authorization record revokes inference immediately even if OS credential cleanup encounters an error.

## Findings

### P0

None found in the implemented G15 scope.

### P1

No open finding is accepted by this report. Final status depends on the Windows release smoke and the final dependency-audit evidence.

### P2

- Existing legacy Local Access Keys are intentionally unrecoverable after upgrade and are labeled accordingly; users may create replacements.
- Desktop shortcut support is Windows-only; other platforms continue to use `serve`.

### P3

- The model-detail route remains state-based rather than URL-persistent.

## Credentials and privacy

`createPlatformSecureStore(account)` now isolates upstream and Local Access Key credentials by account. Windows Credential Manager, macOS Keychain, and Linux Secret Service use the per-key account. Secure-store failures never create a plaintext fallback. The browser copy flow requests a secret only from the authenticated backend and holds it only for the immediate clipboard operation; the React page no longer retains a map of session secrets.

## Windows launcher

`openrouter-sift launch` forces `127.0.0.1`, probes a bounded local port range, opens the browser using a fixed platform URL handler, and gives the UI a random fragment capability. The UI moves that capability to tab-scoped `sessionStorage`, removes it from the address bar, and maintains an acquire/heartbeat/release lease. Multiple launcher tabs are reference-counted and the last tab receives a short grace period before shutdown. `serve` is unchanged. Settings shortcut operations use fixed server-selected paths and do not expose arbitrary process or shell execution.

## Packaging evidence

The package allowlist includes `dist/server`, `dist/ui`, the README, changelog, license, and icon assets. Runtime stores, logs, screenshots, temporary files, and credentials remain ignored. The final gate still requires `npm ci`, tests, lint, build, `npm pack --dry-run`, clean tarball install smoke, secret scan, and Windows smoke against the installed package.

## Regression coverage

Added coverage for secure-store recovery across reload, JSON non-disclosure, revocation cleanup, launcher token validation, multi-tab leases, grace shutdown, startup timeout, and the UI copy endpoint flow. Existing control-plane Host/Origin, managed-key rejection, provider-boundary, body-limit, malformed-JSON, and privacy tests remain part of the full suite.

## Release recommendation

Do not mark `V1.0 READY` until all final gates are green and the Windows installed-package launcher/shortcut smoke has been observed. If any required gate remains unverified, the correct decision is `V1.0 BLOCKED` with that gate listed explicitly.
