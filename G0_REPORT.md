# G0 — Upstream Audit

Audit date: 2026-08-26  
Upstream base: `kumanday/openrouter-provider-shim` main at `d025487`

## Current architecture

- `src/cli.ts` owns the Commander CLI and builds a validated `ShimConfig`.
- `src/config.ts` defines OpenRouter provider-routing fields and combines file, environment, and CLI configuration.
- `src/server.ts` is a small Node HTTP proxy.  All three POST protocols (`/v1/messages`, `/v1/chat/completions`, and `/v1/responses`) read JSON and pass through one provider-policy injection point before the upstream `fetch`.
- `src/policy/providerPolicy.ts` implements the existing `merge`, `override`, and `strict` request-policy behavior.
- `src/util/http.ts` forwards the upstream body chunk-by-chunk with backpressure; it does not buffer the response.  This is the streaming-critical path.
- The upstream has one focused Vitest policy suite (6 tests).  Its test suite and build pass on this Windows environment.  Its `npm run lint` script currently fails before checking code because the upstream repository has no ESLint 9 flat config.

## Reusable behavior

- All three proxy protocols, `/v1/models`, `/healthz`, `/version`, `/config`, authentication passthrough/upstream-key selection, local auth, body limits, and transparent response piping can remain intact.
- The upstream policy type already covers `only`, `ignore`, `order`, `allow_fallbacks`, `sort`, parameter/privacy filters, performance preferences, quantization, and price caps.
- The upstream's strict conflict returns HTTP 422 and must remain the final incoming-request enforcement step.

## OpenRouter API findings

- The official Provider Routing guide currently documents the policy fields used by the shim, including `order`, `allow_fallbacks`, `only`, `ignore`, `sort`, performance preferences, privacy controls, quantizations, and `max_price`.
- OpenRouter states that explicit `order` or `sort` disables its default price-weighted load balancing.  The future UI must therefore present them as alternative routing choices.
- The models API remains `GET https://openrouter.ai/api/v1/models`.  The endpoint API is `GET /api/v1/models/{author}/{slug}/endpoints`; its endpoint fields include time-windowed latency, throughput, and uptime fields.  G2 must cache the real payload rather than inventing normalized values, and must handle the documented possibility that endpoint lookup requires a management key.
- Actual execution must never be inferred from the selected policy.  OpenRouter's opt-in Router Metadata and `X-Generation-Id` generation query can identify the selected endpoint; missing metadata must remain `Unknown`.

Sources: [Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection), [Models API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties).

## Minimal G1 plan

1. Add a validated four-state per-model representation: `inherit`, `allowlist`, `blocklist`, and `custom`.
2. Add an atomic, local JSON policy store.  SQLite is deferred to the storage expansion in later phases; this avoids introducing a native dependency into the upstream's zero-runtime-dependency proxy during G1.
3. Add a pure resolver: choose global policy for `inherit`/no model rule, compile a model rule otherwise, then apply the existing merge/override/strict behavior to the incoming request policy.
4. Wire the resolver into the existing shared POST path after model remapping and before the upstream fetch.  No streaming code changes are needed.
5. Cover policy precedence, rule compilation, empty allowlist rejection, merge modes, persistence, and all three request protocol paths with tests.

## Risks and controls

- **Configuration drift:** the G1 JSON store is intentionally isolated behind a store interface so G5/G6 storage work can replace it with SQLite without changing policy semantics.
- **Control-plane availability:** loading persistence is best-effort; a corrupt/unavailable store logs an error and leaves proxy requests governed by the configured global policy.
- **Secret/privacy:** G1 stores only policy rules. It does not store API keys, prompts, or response bodies.  The upstream debug logger currently includes an authentication-header prefix, which G1 will remove.
- **Model remapping:** selection occurs after the existing Anthropic model remap so policy lookup matches the actual model sent upstream.

## Planned G1 files

- `src/policy/modelPolicy.ts`
- `src/policy/resolver.ts`
- `src/storage/policies.ts`
- `src/config.ts`
- `src/server.ts`
- policy, storage, and protocol tests

No blocking architecture issue was found.  Proceeding to G1.
