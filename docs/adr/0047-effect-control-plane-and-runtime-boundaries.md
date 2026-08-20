# ADR 0047: Effect owns the Electron Main lifecycle control plane

## Status

Accepted.

## Context

Electron Main coordinates several long-lived resources whose correctness depends on time,
cancellation, retries, ordered delivery, and deterministic shutdown. Core event streams,
isolated development runs, and the Codex-compatible app-server each had mature public
interfaces but independently implemented lifecycle state with booleans, promise queues,
timers, abort controllers, and manual disposers. That duplicated ownership logic made
shutdown and reconnect behavior harder to reason about than the product domains they
served.

The Rust Core already owns durable product truth, transactions, authorization, SQLite,
and collaborative documents. Renderer owners already model presentation and local
interaction well. A repository-wide Effect conversion would blur these correct boundaries
and make ordinary modules pay for lifecycle machinery they do not need.

## Decision

Effect 4 is the implementation language for selected Electron Main control-plane modules:

- time, retry schedules, and backoff;
- structured concurrency and cancellation;
- queues, connection barriers, and ordered delivery;
- child-process and transport resource scopes;
- process-lifetime acquisition and finalization.

Effect modules are deep modules. Existing callers continue to depend on Promise,
EventEmitter, callback, and AbortSignal interfaces unless a later decision proves that an
Effect-native public interface has independent value. A narrow compatibility runtime owns
`Effect.runPromise` or `Effect.runFork`; application modules compose Effects without starting
anonymous runtimes.

The architecture frontier is enforced as follows:

1. Rust Core remains the sole durable semantic and storage authority.
2. Renderer, preload, `src/shared`, generated protocol, and transport-neutral wire contracts
   remain Effect-free.
3. Unstable Effect or platform imports are isolated in app-owned `effect-adapters` modules.
4. Layers represent replaceable capabilities or scoped resources, not every stateless
   helper.
5. Tests exercise public lifecycle behavior and use Effect test clocks only where time is
   part of the contract.
6. The Core event-stream supervisor and isolated-run supervisor are independent adoption
   gates. Broader transport and Main composition work proceeds only after both preserve
   behavior while reducing explicit lifecycle state.
7. Electron's platform-required synchronous bootstrap remains ordinary TypeScript. One
   process Scope acquires services only after `app.whenReady()` and is the common shutdown
   boundary for normal quit, startup rollback, and authority-driven relaunch.

The dependency generation is exact and coordinated across `effect`,
`@effect/platform-node`, and `@effect/vitest`. `@effect/tsgo`'s recommended Oxlint preset is
enabled only for Effect control-plane and adapter files: correctness rules are errors while
Effect-native and style guidance remains warning-level evidence during adoption.

## Consequences

Resource ownership and interruption become lexical: closing a Scope releases its child
fibers, subscriptions, timers, and process handles. Retry policy can be tested against a
clock instead of sleeping, and compatibility facades keep migration local to the lifecycle
module being deepened.

Effect is deliberately not a second domain model, protocol schema system, renderer state
framework, or storage authority. New Effect imports outside the control plane must first
change this ADR and the executable boundary checker. New unstable imports require an
app-owned adapter. This makes Effect upgrades and RC API movement visible and bounded.

The optional `msgpackr-extract` native accelerator remains disabled. None of these control
planes use MessagePack as a performance boundary, and accepting another native dependency
would add Electron ABI and packaging risk without product leverage.
