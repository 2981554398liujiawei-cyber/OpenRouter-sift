# OpenRouter Sift — G14 Engineering Audit

Status: audit closed for the `1.0.0-rc.1` release candidate.

Scope was limited to input reliability, Local Access Key creation, OpenRouter
native session affinity passthrough, cache metadata observability, engineering
maintainability, and release evidence. No quota, database, cloud, account, or
new routing subsystem was introduced.

## Threat model and boundaries

Assets:

- OpenRouter upstream API key and OS credential-store entry.
- `sift_sk_…` Local Access Keys and their Desired Model permissions.
- Control Key and control-plane settings.
- Desired Model policy, Provider Filters, request metadata, and local JSON stores.

Trust boundaries:

```text
Browser UI ── /api/* ── Sift control plane
AI clients ── /v1/* ── Sift inference boundary
Sift ── fixed https://openrouter.ai ── OpenRouter
Sift ── platform adapter ── OS credential store
Sift ── atomic JSON stores ── local runtime metadata
```

Security and privacy invariants rechecked in the existing G12 suite and new G14
tests:

- A Local Access Key cannot authorize `/api/*`.
- Client input cannot widen Desired Model permissions or the final Provider Set.
- OpenRouter credentials are never returned as plaintext or written to normal JSON stores.
- Prompt, response, reasoning, tool arguments, and session ID values are not persisted.
- Control Key state is browser-memory-only; `/ui` static assets remain loadable when control auth is enabled.
- Host/Origin checks, body limits, malformed JSON handling, hard-filter fail-closed behavior, and response security headers remain enforced.

## Findings

### P0

None found. No remote-control or credential-disclosure path was identified.

### P1 — fixed

| ID | Affected surface | Evidence | Fix | Regression | Status |
|---|---|---|---|---|---|
| G14-001 | Provider Filter and Settings numeric editors | Immediate `Number(input.value)` converted `0.` / `0.01` during editing and could lose the draft | Keep editor strings; parse and validate only for preview/save | `numeric-draft.test.ts`, `ui-desired-model-detail.test.tsx`, Settings typecheck | Fixed |
| G14-002 | Local Access Key creation | Async create had no explicit submit state and persistence failure could leave an in-memory key | Form submit lock, inline validation/error, safe secret modal, store rollback | `ui-access-keys.test.tsx`, `access-storage.test.ts` | Fixed |
| G14-003 | `/v1/*` sticky routing | `session_id` and `x-session-id` were not explicitly preserved | Forward only the validated body field and `x-session-id`; never forward arbitrary headers; allow safe response header | `g14-session-cache.test.ts` | Fixed |
| G14-004 | Request metadata | Cache usage returned by an inference response was not represented in the request DTO | Parse metadata-only cache fields and expose them in list/detail UI without storing content | `cache-metadata.test.ts`, `g14-session-cache.test.ts` | Fixed |

### P2 — fixed or deliberately bounded

| ID | Affected surface | Evidence | Fix / decision | Status |
|---|---|---|---|---|
| G14-005 | `/api/requests` list DTO | Server list mapping omitted newly tracked cache/session fields even though detail records had them | Reuse the canonical request list projection | Fixed |
| G14-006 | Filter editor state | Disabled/incomplete condition drafts could diverge from the preview payload | Canonicalize enabled conditions once for preview/save; block invalid save | Fixed |
| G14-007 | Provider order UX | Ordered providers can conflict with upstream sticky affinity | Add explicit sticky-routing guidance in model and per-key provider-order editors; keep final hard filter authoritative | Fixed |
| G14-008 | Streamed cache metadata | A streamed body is intentionally not buffered or persisted; cache usage is shown only when present in safe response/generation metadata | Accepted bounded behavior; no content buffering added |
| G14-009 | Large core modules | `src/server.ts` and `ui/src/DesiredModelDetail.tsx` remain large after G13 | No risky broad rewrite during release closure; touched logic is isolated by helpers and canonical projections | Deferred |

### P3

No release-blocking P3 finding. Existing product limitations remain documented:
Cursor is manual/unverified, generation enrichment is best-effort, and model
detail state is not persisted in the URL.

## Engineering decisions

- There is no local session database and Sift does not generate a `session_id`.
  The client owns affinity identity and OpenRouter remains the sticky-router authority.
- Cache fields are numeric/status metadata only: prompt tokens, cached input,
  cache writes, discount, status, and age. Prompt/response content is not parsed
  into records or logs.
- API Key create/update/delete now roll back the in-memory mutation if atomic
  persistence fails.
- Browser control authentication remains in-memory only and uses the server as
  the sole authorization authority.
- Existing G11 stores and environment configuration remain compatible; no store
  migration was required.

## Evidence required for seal

- Unit/integration tests include intermediate numeric drafts, key creation
  validation/single-flight, persistence rollback, three protocols, streaming
  session passthrough, cache metadata extraction, and privacy assertions.
- CI matrix is Ubuntu Node 20/22 plus Windows Node 20 and runs install, test,
  lint, build, runtime audit, package dry-run, and tarball smoke.
- Release evidence must still record the final `npm ci`, test, lint, build,
  diff-check, secret scan, package scan, clean install, and Windows smoke exits.
