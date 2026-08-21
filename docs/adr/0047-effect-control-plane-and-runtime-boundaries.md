# ADR 0047: Effect owns the Electron Main lifecycle control plane

## Status

Accepted.

## Context

Electron Main coordinates long-lived resources whose correctness depends on time,
cancellation, retries, ordered delivery, and deterministic shutdown. Core event streams,
windows, workers, terminals, browser sessions, schedulers, and the Codex-compatible
app-server previously implemented lifecycle state independently with booleans, promise
queues, timers, abort controllers, and manual disposers. That duplicated ownership logic
made shutdown and reconnect behavior harder to reason about than the product domains they
served.

The Rust Core already owns durable product truth, transactions, authorization, SQLite,
and collaborative documents. Renderer owners already model presentation and local
interaction well. Extending Effect into renderer state, durable domain logic, or pure
calculations would blur these correct boundaries and make ordinary code pay for lifecycle
machinery it does not need.

## Decision

Effect 4 is the application-kernel model for Electron Main wherever work involves:

- time, retry schedules, and backoff;
- structured concurrency and cancellation;
- queues, connection barriers, and ordered delivery;
- child-process and transport resource scopes;
- process-lifetime acquisition and finalization.

Effect Modules are deep Modules: their Effect/Stream interfaces hide resource handles,
mutable coordination state, concurrency, retries, and release ordering. Main-internal
callers compose those interfaces directly. Promise, EventEmitter, callbacks, and
AbortSignal are allowed only at actual Node, Electron, worker, Core, or legacy cut-over
adapters; ordinary application Modules never start anonymous Effect runtimes.

The architecture frontier is enforced as follows:

1. Rust Core remains the sole durable semantic and storage authority.
2. Renderer, preload, `src/shared`, generated protocol, and transport-neutral wire contracts
   remain Effect-free.
3. Node and Electron capabilities live behind app-owned platform adapters; unstable Effect
   or platform imports remain isolated at those seams.
4. Layers represent replaceable capabilities or scoped resources, not every stateless
   helper.
5. Tests exercise public lifecycle behavior and use Effect test clocks only where time is
   part of the contract.
6. Dynamic resources use their semantic owner: keyed host/session families use `LayerMap`,
   reference-counted keyed coordination uses `RcMap`, callback ingress uses scoped fiber
   tracking, ordered commands use `Queue`, and observation-only fan-out uses `PubSub` or
   `Stream`.
7. Electron's platform-required synchronous bootstrap remains ordinary TypeScript. One
   process Scope acquires services only after `app.whenReady()` and is the common shutdown
   boundary for normal quit, startup rollback, and authority-driven relaunch.

The dependency generation is exact and coordinated across `effect`,
`@effect/platform-node`, and `@effect/vitest`. Effect-specific Oxlint rules are installed
through the repository's Effect tsgo patch and the unified check must remain warning-free.

## Consequences

Resource ownership and interruption become lexical: closing a Scope releases its child
fibers, subscriptions, timers, and process handles. Retry policy can be tested against a
clock instead of sleeping, and keyed replacement uses the same release contract as process
shutdown.

Effect is deliberately not a second domain model, protocol schema system, renderer state
framework, or storage authority. Renderer, preload, shared contracts, and generated wire
types remain Effect-free under executable boundary checks. New unstable imports require an
app-owned adapter. This makes Effect upgrades and RC API movement visible and bounded.

Project lifecycle mutation and admission of new Project-owned runtime work share one
process-scoped, Project-keyed runtime gate. Codex turns, Terminal sessions, and other host
work revalidate durable Project lifecycle while holding that gate. Callers may project this
contract through a tracked Promise adapter during cut-over, but they must not create a
parallel lock map or process singleton.

The optional `msgpackr-extract` native accelerator remains disabled. None of these control
planes use MessagePack as a performance boundary, and accepting another native dependency
would add Electron ABI and packaging risk without product leverage.
