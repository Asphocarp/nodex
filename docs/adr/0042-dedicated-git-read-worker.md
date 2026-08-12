# ADR 0036: Dedicated Git Repository Read Worker

## Status

Accepted

## Context

Review, the floating Changes summary, branch selectors, commit preparation, and
patch actions all observe the same mutable Git repository. When each renderer
surface independently asks Main to construct a complete snapshot, one user
edit can fan out into several full status scans. Those reads can overlap with
one another and with mutations, and a newer filesystem event can make an older
result obsolete after expensive work has already completed.

Git is the durable source of truth, but it does not provide an application
snapshot transaction spanning the worktree, index, refs, and untracked files.
Nodex therefore needs one rebuildable read plane that assigns generations,
orders access, shares identical work, and treats ordinary invalidation as data.
Main must retain Electron lifecycle and product orchestration without becoming
a second repository-state owner.

## Decision

### One worker owns each repository read plane

One process-lifetime Node worker thread owns Git repository observation and
queries. It canonicalizes a worktree as `(hostId, real commonDir, real root)`.
Every `WorktreeRepository` owns:

- one serialized command lane shared by reads and local mutations;
- one monotonic repository generation;
- one reference-counted semantic watcher lease;
- shared in-flight queries keyed by method, normalized parameters, and
  generation;
- a bounded untracked-path cache and operation-local performance counters.

Git remains authoritative. Worker caches are disposable and may be rebuilt
after invalidation or worker restart.

### Main and renderer are adapters

Main owns the worker lifecycle, authorizes the narrow worker message bus, maps
requests to their renderer owner, and cancels owned work when a renderer is
destroyed. Preload exposes only the typed from-view/for-view bus. Renderer uses
one `GitWorkerClient` and one Query-cache coordinator per window; components
compose query results and view state rather than owning subscriptions or
repository snapshots.

The same query identity is used for direct reads and live refreshes, so active
consumers coalesce instead of starting duplicate Git processes. Live results
may publish a tracked phase followed by a complete phase after bounded
untracked discovery. Untracked materialization is capped; results report the
omitted count rather than hiding truncation.

### Stale, cancellation, and operational limits are results

A query that finishes after its repository generation changes returns a typed
stale result. AbortSignal cancellation, command timeout, non-zero exit, and
output-limit outcomes stay within the operation result contract. They do not
become Electron handler exceptions or remote crash reports.

Protocol violations, an unexpected worker error, and an unexpected worker exit
remain infrastructure defects. Main reports those once, retires the epoch,
settles pending requests as worker-unavailable, and lazily starts a new epoch.
Active renderer queries resubscribe; Nodex never falls back to a legacy Main
snapshot implementation.

### Mutations share the same invalidation owner

Repository initialization, patch application, branch checkout/creation, and
the pure Git commit run through the worker lane. Each mutation advances the
appropriate repository generation before it resolves. Main retains commit and
pull-request message generation plus GitHub and push orchestration, but obtains
Git status and patch context through the worker. Main-owned push always asks
the worker to refresh repository state after the attempt.

## Consequences

- A passive Review or Changes update performs at most one identical repository
  query per generation, even across multiple renderer consumers.
- Reads and local mutations cannot publish out of order for one common Git
  directory.
- Tracked results can arrive without waiting for an expensive untracked scan,
  while completion remains explicit and bounded.
- Worker memory and watchers are recoverable infrastructure rather than a
  second durable state store.
- Renderer and Main no longer expose operation-specific snapshot/live IPC
  channels; adding a Git query requires updating the typed worker protocol and
  invalidation matrix.
- Operational telemetry can measure queueing, command count, scan count,
  coalescing, cancellation, and limits without including paths or diff content.

## Rejected alternatives

### Keep snapshots in Main and debounce renderer calls

Debouncing reduces some calls but leaves multiple state owners, cannot share
work across windows, and does not serialize reads with mutations.

### Run every Git command independently in the worker

Moving processes off Main without a per-repository query kernel preserves the
same amplification and stale-publication races in a different thread.

### Fall back to Main when the worker fails

Two implementations would produce different generations and recovery rules.
A worker failure is instead an explicit unavailable epoch followed by
reconstruction of the single read plane.

### Treat every canceled or stale command as an exception

Invalidation and cancellation are normal consequences of editing and
navigation. Reporting them as crashes obscures real protocol and worker
failures and floods local logs.
