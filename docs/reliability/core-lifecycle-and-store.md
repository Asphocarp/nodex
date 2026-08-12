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

## Store formats and migrations

Core owns the current executable Store schema in
`crates/nodex-core/src/infrastructure/schema.rs`. The migration implementation,
accepted frozen inventories, exact current version, and validation gates live
in `crates/nodex-core/src/infrastructure/migration.rs`,
`legacy_migration.rs`, the checked-in schema artifacts, and their tests. Those
files are the only source of truth for a version inventory.

A migration follows one durable pattern:

1. identify an exact recognized source inventory;
2. create and validate a content-addressed database/assets backup;
3. migrate only a staged copy through the applicable frozen/native path;
4. rebuild derived projections and validate semantic authority;
5. atomically publish the complete target Store;
6. retain evidence sufficient to diagnose or retry an interrupted publication.

Unknown, future, ambiguous, drifted, partially migrated, or damaged inventories
fail closed. Import compatibility is staging-only and never becomes a live
runtime branch. Reopening a current Store validates its exact physical and
semantic invariants rather than silently repairing damage.

Migration progress is authoritative evidence, not elapsed-time estimation. The
startup UI remains quiet for ordinary opening, shows migration language only
after Core classifies a supported older Store, and changes to opening language
as soon as Store readiness commits.

## Validation owner

The source gate, migration matrix, current/frozen inventory tests, process-
lifecycle tests, and packaged runtime verification are executable authority.
Release packaging and frozen legacy acceptance are documented operationally in
[the macOS Release Runbook](../release-macos.md).
