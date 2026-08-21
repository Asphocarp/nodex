# Core Lifecycle and Store Reliability

## Authority selection

Electron fixes one Profile, Library, Store epoch, and Core authority before
initializing product Adapters. The launcher selects or starts one authenticated
ready Core generation and completes compatibility checks across transport,
events, Module contracts, Store identity, and packaged artifact policy. Initial
selection failure is terminal for that launch; Electron never opens SQLite or
falls back to a JavaScript writer.

Core is a detached per-Profile process. An active authenticated Host connection,
event stream, CLI client, Document subscription, Store operation, or due
Automation is demand. Core may idle-drain only after every demand source is
gone. A lifecycle breadcrumb under the Profile run directory is bounded,
contains no content or secret, and remains diagnostic rather than authority.

## Generation recovery

Electron retains one process-lifetime authority supervisor and one logical Core
connection identity. Definitive transport loss may start a single-flight
selection of another ready generation only when Profile, Library, and Store
epoch still match. Stable Module facades, projection cursors, Document/Canvas
subscriptions, and schedulers survive the physical connection change.

Reads and writes with stable idempotency identity may retry once with their
original input. Ephemeral Awareness triggers recovery but is never replayed.
A request timeout alone is ambiguous and does not prove writer loss.

## Request execution

Every Core Module request has a connection-scoped request ID, an execution
class, and one absolute Core-owned deadline. The production executor admits at
most 128 requests, runs at most four synchronous Module operations at once,
allows at most three background operations and one maintenance operation, and
therefore always preserves one execution slot for interactive work. Default
deadlines are 20 seconds for interactive work, 60 seconds for background work,
and 120 seconds for maintenance; clients may declare a bounded deadline from
250 milliseconds through five minutes.

Admitted synchronous work runs on Tokio's blocking pool rather than the async
HTTP workers. The request context follows the work into Store reader checkout,
writer queueing, and SQLite progress handlers. Transported work uses that one
request deadline throughout; the Store's defensive fallback budget applies
only to direct calls outside a request context and never shadows the declared
request lifetime. Caller cancellation is sent to `/core/v1/requests/cancel`
with the same connection/request identity and interrupts SQLite cooperatively;
Core attributes SQLite's generic interrupt outcome back to the originating
deadline or cancellation token. A response may return before an uncooperative
blocking closure exits, but its execution permits remain held until the closure
actually stops. The serialized Store writer is a cooperative boundary: callers
poll the same cancellation/deadline while queued, release their blocking worker
promptly, and immediately evict a cancelled command that is still queued. A
command racing with dequeue retains the same cancellation token and cannot
execute domain side effects after the boundary expires.

The writer schedules a bounded total queue by request class. Interactive work
runs before unaged background and maintenance work; aging promotes one older
lower-class command so sustained interaction cannot starve upkeep. Maintenance
commands must therefore be short slices. Block collection plans a bounded pass,
loads its evidence once from a consistent WAL reader snapshot, and validates
that snapshot's LocalCommit head before every writer slice. Each candidate
commits in its own transaction, and the coordinator leaves the writer between
slices. An intervening product commit invalidates the plan and defers collection
instead of deleting from stale evidence. Increasing a request deadline is not a
substitute for these cancellation and yielding contracts.

Core reports `deadline_exceeded`, `cancelled`, and `overloaded` as semantic
Module errors. Electron's HTTP timer is the semantic deadline plus a five-second
liveness grace. Crossing only that outer grace is a transport timeout and still
does not prove Core generation loss or mutation failure. Interactive Page
search cancels stale enrichment requests end to end. Scheduled Store
maintenance is globally single-flight before it enters Core, then also uses the
executor's maintenance lane.

Core health reports active and queued requests, admission wait and execution
duration, and cumulative deadline, cancellation, and overload counts. Store
writer/reader/query metrics remain the next-level evidence for locating where
admitted work spent its time. Deadline logs also identify the bounded execution
phase (`admission`, `module_cpu`, reader checkout/query, writer queue/execution,
or response), admission wait, and request class without logging request bodies
or resource identities.

Repeated independently authenticated losses open a bounded local circuit. The
renderer shows one app-wide unavailable state with explicit Retry and Restart
rather than accumulating feature-local errors. Shutdown advances a lifecycle
fence so a late selector, health result, or recovery cannot republish readiness
or start work.

Store restore, Profile/Library mismatch, and Store-epoch change are authority
replacement, not generation recovery. They require controlled application
relaunch.

## Background producers

During recovery or an open circuit, backup, retention, reminder, and scheduled-
Automation producers keep their timer/configuration state but neither claim nor
start new Core work. They recheck admission after every asynchronous claim or
initialization step. A lease returned after authority changes is settled for a
bounded retry without delivering a notification or starting an agent run.
Scheduled claims, lease settlement, reminder delivery, interrupted-run recovery,
and native agent Document work declare the background class at their semantic
adapter boundary; user-initiated Automation editing remains interactive.

## Store formats and migrations

The leaf `nodex-store-format` crate owns the published Store catalog: lineage,
supported revisions, exact normalized schema fingerprints, and current
identity. Core protocol manifests and Host requirements derive their Store
identities from that catalog instead of restating version or fingerprint
constants. `PRAGMA user_version` is the only revision authority in the SQLite
file. `core_store_metadata` records current Rust Core ownership state;
`core_store_migration_history` retains completed migration evidence without
duplicating the current revision.

`prepare_profile_store_with_observer` is the only live Store-open preparation
entry point. An empty Store installs the complete `current.sql` snapshot and
mints its Profile-specific singleton rows in the same transaction, so an
interrupted first open remains an empty, retryable database. A current Store
must match the catalog's exact current fingerprint. A supported predecessor
must match its catalog fingerprint, complete revision-independent semantics,
and reconstructible Yrs Documents before migration is reported or a backup is
published.

Deep Store validation checks SQLite integrity and foreign keys, exact schema
and Core metadata, durable semantic invariants, and LocalCommit coverage and
parentage. It is required before fresh Stores, migrations, restores and other
replacement recovery, and whenever opening cannot prove that the immediately
previous Core generation closed cleanly. A clean Core shutdown publishes one
private, atomic validation receipt after graceful drain. The next generation
consumes that receipt before opening SQLite and may take the trusted path only
when its current schema revision, Store epoch, and LocalCommit head exactly
match, after rechecking schema and Core metadata. Receipt consumption is
single-use: crash, interrupted startup, missing/invalid/stale receipt, or any
changed Store identity forces deep validation. An unsafe receipt filesystem
entry is rejected as an invalid Profile rather than trusted. Failure to publish
a receipt is safe; it only makes the following startup validate deeply.

Startup logs record durations for SQLite integrity, foreign-key, semantic and
canonical timestamp validation, LocalCommit validation, planner maintenance,
and runtime startup so large-Profile opening cost is attributable without
logging content.

A migration follows one durable pattern:

1. identify an exact recognized source inventory;
2. validate source semantics before reporting migration work;
3. create and verify a regular content-addressed SQLite Online Backup;
4. apply the ordered forward step in one `BEGIN IMMEDIATE` transaction;
5. rebuild affected projections and validate exact current physical and
   semantic authority inside that transaction;
6. commit the target revision and one migration-history row together.

The verified backup exists before the write transaction and remains available
after either success or rollback. A failed transaction leaves the live Store at
its exact source identity. A successful reopen observes the current identity
and does not repeat the backup or history row. Native migration does not replace
the Store file with a staging copy and therefore does not rotate Store epoch or
enter the Store-replacement journal.

Yrs is the authority for Document content during migration. If a migration
changes the interpretation of derived materialization records, Core validates
the Yrs update chain and state vector before the transaction, rebuilds the
current materialization and normalized Page-reference projection inside that
transaction, then performs the exact materialization check afterward. The
materialization derivation version is independent from the Document schema
version so future derived-record changes can add an explicit rebuild step.

Unknown, future, ambiguous, drifted, partially migrated, or damaged inventories
fail closed before backup or mutation. Reopening a current Store validates its
exact physical and semantic invariants rather than silently repairing damage.

Before every Store revision bump, maintainers must check in a database produced
by the exact current Core under
`crates/nodex-core/tests/fixtures/store-v<revision>.db`, before changing that
Core's schema. The repository retains fixtures only for the deliberately
supported migration window. The aggregate migration gate copies the minimum
supported artifact into a disposable Profile, opens it through the real Store
path, proves the content-addressed backup and source revision, validates
convergence with a fresh `current.sql` Store, closes it, and reopens it without
another migration. Reverse-removing current schema objects remains acceptable
only for narrow failure injection; it is not predecessor-boundary evidence.

Migration progress is authoritative evidence, not elapsed-time estimation. The
startup UI remains quiet for ordinary opening, shows migration language only
after Core classifies a supported older Store, and changes to opening language
as soon as Store readiness commits.

## Validation owner

The version-surface source gate, Store catalog continuity test, migration
matrix, current/frozen inventory tests, previous-published reopen gate,
process-lifecycle tests, and packaged runtime verification are executable
authority. Every retained Rust and TypeScript version declaration is classified
as runtime compatibility, durable format, or algorithm identity with an owner
and a coexistence, migration, invalidation, or rejection strategy. Same-build
DTO contract versions are forbidden.
Release packaging and supported-baseline acceptance are documented operationally in
[the macOS Release Runbook](../release-macos.md).
