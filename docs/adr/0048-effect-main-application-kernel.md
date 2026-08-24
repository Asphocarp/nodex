# ADR 0048: Electron Main is one scoped Effect application

## Status

Accepted — 2026-08-24

This decision supersedes [ADR 0047](0047-effect-control-plane-and-runtime-boundaries.md).
ADR 0047 established the Effect frontier; this ADR records the completed process topology and
removes the former allowance for application-internal cut-over adapters.

## Context

Electron Main is Nodex's host application. It coordinates the Rust Core authority, Codex
app-server endpoints, windows, IPC, Terminal sessions, Browser guests and profiles, workers,
schedulers, native notifications, updates, and shutdown. These resources share cancellation,
ordering, retry, and release requirements even though their product domains remain independent.

Splitting lifecycle ownership between a root Scope and application classes that retain Promise
queues, timers, callback registries, or manual shutdown lists creates two execution models. A
resource can then be visible to one model but not the other during startup failure, reconnect, or
quit. Durable product state does not belong in either model: Rust Core remains its sole authority.

## Decision

Electron Main runs as one Effect application with one process root and one Profile-scoped resource
graph.

- Platform-required synchronous bootstrap captures pre-ready Electron events without acquiring
  process services. After `app.whenReady()`, the Main application Scope acquires the complete
  Profile graph and atomically attaches the buffered ingress.
- `MainShutdown` is the single quit/relaunch decision authority. Normal quit, signal, startup
  rollback, Store restore, and Core authority drift all close the same application Scope before
  asking Electron or the external launcher to terminate or relaunch.
- Process capabilities are `Context.Service` interfaces. Scoped resources are constructed by
  Layers or scoped `make` Effects. Keyed dynamic resources use the owning `LayerMap`, `RcMap`,
  `FiberMap`, or equivalent scoped family; callbacks enter through a scoped fiber runtime.
- Core and Codex transports have one physical owner per generation. Their application consumers
  use typed Effect capabilities and generation-fenced Streams; they do not create parallel
  reconnect, request-correlation, timeout, or event-buffer state.
- Each Codex Thread generation owns one private Conversation Entity state and causal command lane.
  Hydration, protocol ingress, renderer ownership, request responses, Turns, forks, worktrees, and
  projections compose that authority rather than mirroring it in an application facade.
- Window, Terminal, Browser, worker, scheduler, updater, and notification lifetimes are children of
  the Profile Scope or of an explicitly narrower semantic owner. Closing a child releases only its
  resources; closing the Profile interrupts all remaining admission and releases the graph in
  dependency order.
- Promise, callback, `AbortSignal`, EventEmitter, and synchronous return values are permitted only
  where an external Electron, Node, worker, Core wire, generated protocol, preload, or renderer
  contract requires them. The adapter converts once and owns no application policy or competing
  lifecycle state.
- Renderer, preload, `src/shared`, generated protocol code, and Rust Core remain Effect-free. Pure
  computation remains ordinary TypeScript. Unstable Effect platform APIs remain isolated behind
  `src/main/platform` capabilities.

The architecture gate enforces these boundaries. Production application Modules may not create
anonymous Effect runtimes, ambient process configuration, unscoped timers, Promise coordination,
AbortController registries, or EventEmitter application buses. Effect tests use the managed test
runtime and TestClock when time is part of the contract.

## Consequences

Startup acquisition and rollback are lexical. Scope release is the authoritative shutdown
operation, so pending requests, fibers, listeners, timers, children, workers, PTYs, and queues are
visible to one resource graph. Finalizer failures remain observable without silently skipping later
cleanup.

Application Modules expose semantic operations and typed failures instead of resource handles.
They can be tested with capability substitution at their public interface, while platform
integration tests prove actual Electron ABI, process, worker, and native-resource cleanup.

The composition root is intentionally large enough to show the dependency graph, but it does not
own subsystem policy through callback bags. A dependency cycle is resolved by identifying the
canonical state or transaction owner and making callers depend on that capability. Migration-only
facades, Promise adapters, duplicate event buffers, and legacy lifecycle tests are deleted once the
final capability is connected.

Effect is not a second durable domain model. Core transactions, authorization, SQLite, Yrs, and
persisted event history remain authoritative. Main owns process coordination and projections; the
renderer owns presentation and local interaction.

## Rejected alternatives

### Keep a scoped root around independently managed application classes

A finalizer that calls class-level `shutdown()` does not give the Scope ownership of the class's
pending work. It preserves two cancellation and release models and cannot prove rollback or
exactly-once settlement.

### Retain Promise adapters as the normal internal interface

Promise conversion is required at real platform ingress, but an internal Promise service erases
typed requirements, interruption, Scope, and Stream semantics. Keeping it as a convenience API
would make the cut-over boundary permanent.

### Move Effect into Core, preload, shared contracts, or renderer state

Those layers already have correct authorities and execution models. Expanding Effect there would
increase coupling without improving Main resource ownership.

### Wrap every pure helper in Effect

Layers and Effects represent capabilities, failure, I/O, time, concurrency, or lifetime. Ordinary
deterministic computation stays as plain functions so Module depth comes from hiding complexity,
not from additional ceremony.

## Acceptance

The decision is complete when production Main has one process root and one application Scope;
dynamic resources are Scope-owned; internal application interfaces are Effect/Stream based; Core
and Codex have no parallel transport or lifecycle owner; shutdown and startup rollback leave no
orphan process, worker, PTY, listener, fiber, queue, or pending request; the Effect boundary gate,
standard suites, production build, runtime lifecycle gate, and packaging rehearsal pass.
