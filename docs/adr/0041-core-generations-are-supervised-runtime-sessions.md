# ADR 0034: Core generations are supervised runtime sessions

## Status

Accepted

## Context

Nodex runs one detached Rust Core per Profile. Electron, the native CLI, and
the optional background service all select that same exclusive SQLite and
Document authority. Detachment is intentional: the process that happened to
launch Core is not necessarily its only client or its lifetime owner.

Core also has a bounded idle policy. An authenticated client, event or Document
stream, prepared operation, Store work, or due Automation is active demand and
prevents idle drain. Once all demand disappears, Core may exit and a later
client may start a fresh process generation against the same Store.

Electron previously treated the first authenticated UDS client as permanent.
Its adapters and logical stream supervisors continued reopening the first
generation's socket after that generation crashed or drained. A long-running
window could therefore remain healthy for hours and then accumulate unrelated
view errors even though the selector could safely start or reuse another Core.

The durable authority identity is the Profile, Library, and Store epoch. PID,
start nonce, readiness generation, connection binding, socket, and capability
belong to one replaceable process or connection generation.

## Decision

Electron Main's process Scope owns one Effect `CoreAuthority`. It exposes stable
root and Project clients through `DesktopCoreAdapter`; every operation resolves
the current authenticated generation at execution time. Existing Desktop
adapters, Projection routing, event cursors, Document/Canvas logical
subscriptions, and schedulers retain their object identity across a swap.

One Electron process also keeps one logical Core connection ID for its whole
lifetime. Re-running the handshake against the same generation refreshes that
one registry record instead of accumulating a new 24-hour client record on
every rebound. A new Core process has a fresh in-memory registry and accepts the
same logical Host identity normally. This ID is authentication/session metadata;
it is never a durable mutation identity.

Definitive UDS loss (`ENOENT`, `ECONNREFUSED`, `ECONNRESET`, or `EPIPE`) and an
authenticated draining response enter one single-flight recovery. Recovery
always re-runs the normal selector and full handshake. It never kills a PID,
deletes runtime files, opens SQLite in Electron, or bypasses the Profile lock.
Concurrent callers wait for the same candidate, and a late error from an old
session cannot replace a newer accepted session.

A candidate is adopted only when it is ready and exactly matches the baseline
Profile, Library, and Store epoch. Compatibility remains enforced by the
selector and handshake. Profile or Library drift fails closed. A changed Store
epoch is a whole-App relaunch boundary because renderer caches and logical
sessions belong to the previous Store world.

Request timeouts are ambiguous: Core may still hold a transaction or may have
committed after the client stopped waiting. A timeout alone therefore neither
replaces Core nor causes generic replay. After definitive generation loss,
ordinary reads and operations carrying existing stable idempotency identities
may be replayed exactly once with the original input. Receipt fingerprints bind
the semantic authority and intent but exclude transient connection IDs. A Yjs
update additionally binds the renderer's logical client-session ID, which stays
stable while its physical authenticated connection changes. Awareness
publications are ephemeral: they can initiate recovery but are not automatically
replayed.

The global event and Document stream supervisors remain logical connections.
They reopen physical streams through the stable facades from their last
accepted cursors and use the existing gap/resync contracts. One disconnected
episode emits one reconnect resync and one bounded warning until a new stream
is authenticated. Background producers retain their scheduler state but stop
claiming new Core work while authority is not ready. They repeat this admission
check after every awaited initialization or claim boundary; claims returned
after authority loss are settled for a bounded retry without starting their
external work.

Three observed session losses or failed selections within one minute open a local
circuit and pause automatic recovery. Main publishes one renderer-safe status
for every window. A short recovery is silent for 1.5 seconds and then shows one
compact reconnect notice; circuit-open unavailability offers explicit Retry
and Restart actions. The renderer receives no PID, nonce, socket, capability,
or raw error.

Core continues to own its lifecycle. Each generation records a private,
fixed-size lifecycle summary with a typed graceful drain reason and completed
stop outcome. A later winner may classify an unfinished prior generation only
as unclean-observed. This breadcrumb is diagnostic, contains no user content or
transport secret, and cannot participate in authority selection.

Recovery is fenced by the `CoreAuthority` Scope and lifecycle generation.
Closing the Scope invalidates every candidate already being selected or
health-checked; such a candidate cannot publish `ready` or receive a replay. A
late failure from an older session first joins any recovery already replacing
the current session, rather than replaying onto the current-but-failing
connection. Failure counting deduplicates concurrent reports from the same
session object, not every connection that happens to address the same process
generation.

## Consequences

- An open Nodex Host and its authenticated global stream are ordinary demand;
  no heartbeat or disabled idle timeout is required.
- Rebinding a long-running Host does not grow Core's client registry, while
  independent CLI and test clients still receive independent connection IDs.
- A Core crash does not invalidate Desktop adapter identity or durable stream
  cursors when the authority world is unchanged.
- Exact retry is deliberately narrower than generic request retry. New mutation
  APIs must provide a stable receipt identity before becoming replayable.
- Restore and other Store-epoch changes remain explicit relaunch boundaries;
  hot recovery cannot combine state from two Store worlds.
- Crash loops become one bounded availability state instead of independent
  module and stream retry storms.
- Core can still outlive Electron for CLI or background work and can still
  idle-exit after all real demand disappears.

## Rejected alternatives

- Make Core an ordinary BrowserWindow or Electron child. This breaks
  launcher-independent CLI reuse and confuses App/window lifetime with Store
  authority lifetime.
- Run Core forever or set the Desktop idle timeout to zero. This leaks a
  background process after demand disappears and makes optional background
  execution a correctness dependency.
- Send a TTL heartbeat. Sleep, App Nap, and event-loop stalls make liveness
  timers weaker than the authenticated connections and stream leases Core
  already owns.
- Kill a remembered PID or unlink its socket after timeout. Neither action
  proves generation identity or transaction safety and both can violate the
  single-writer invariant.
- Recreate every adapter and renderer store after a crash. That duplicates
  recovery policy, loses durable cursors, and turns a transport-session change
  into an unnecessary product-session reset.

## Acceptance

With a short test idle timeout, an authenticated client or global stream keeps
Core ready across multiple idle periods, while a demand-free Core still exits.
Killing a disposable test generation causes one selector recovery; the same
root and Project facades continue to read, and replaying the original operation
returns its duplicate receipt without another event. Authority mismatch fails
closed, three independent rebound-session losses open the circuit even when all
three target one process generation, close fences a pending candidate, and a
late old-session error joins the active replacement. A Yjs commit whose response
is lost replays through a new physical connection with the same logical client
session. Scheduler tests withdraw returned claims when authority changes during
an await. Renderer status remains global and bounded. Lifecycle tests
distinguish typed graceful reasons from an unclean prior generation without
recording secrets or content.
