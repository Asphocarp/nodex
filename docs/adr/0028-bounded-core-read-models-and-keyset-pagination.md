# ADR 0028: Core growing collections use bounded keyset windows

- Status: Accepted
- Date: 2026-07-25
- Owners: Nodex maintainers
- Extends: ADR 0023, ADR 0024, and ADR 0025

## Context

Core protects its private HTTP transport with request and response byte caps.
The Rust server accepted a 16 MiB ordinary response while the Electron client
accepted only 512 KiB and the native Rust client accepted 64 MiB. More
importantly, several read paths returned every Session, Thread, Database row, or
sidebar order in one response. Raising the smallest cap could restore one
Profile, but any fixed cap would fail again as those collections grew.

Some APIs exposed `limit` and cursor fields while still materializing the whole
query and applying an array offset afterward. That shape bounded only the final
slice; it did not bound SQLite work, Document projection reads, memory, or
serialization. OFFSET also becomes progressively more expensive and is
unstable when rows are inserted ahead of a later page.

## Decision

Private transport version 4 owns its budgets in `nodex-core-protocol`. Ordinary
JSON requests are capped at 2 MiB and responses at 16 MiB. The generator
publishes the same values to TypeScript. Document JSON, Document frames, and
committed-event frames remain separate protocol axes. Clients may inject a
smaller response cap for tests, but production cannot negotiate or configure a
larger ordinary cap.

Every Module collection whose cardinality can grow with user data uses the
shared `CollectionWindowRequest` and `CollectionWindow<T>` contract. `first`
defaults to 50 and is bounded to 200. Core also enforces a 1 MiB encoded JSON
budget, so a window may contain fewer than `first` items. A single item that
cannot fit is a typed `resource_exhausted` error and must be redesigned as a
summary plus identity read rather than allowed to consume the transport cap.

Continuations are opaque, URL-safe, HMAC-signed keyset cursors. A cursor binds:

- the cursor format and read kind;
- Library and Store epoch;
- a canonical query fingerprint;
- the projection revision used by the first window;
- direction;
- the last row's typed sort values and stable identity.

Core rechecks authorization, query validity, and projection authority on every
request. The cursor conveys a coordinate only; it never conveys access. A Store
replacement returns `stale_store_epoch`, while a mutation that invalidates the
ordered projection returns `revision_conflict`. Consumers discard the cursor
and reread from the first window.

Each owning Module must issue an indexed keyset query with a stable identity
tiebreaker and `LIMIT first + 1`. The shared assembler enforces count and encoded
byte budgets, but intentionally does not hide an unbounded source query.
OFFSET, full-load-then-slice, full Document reads followed by summary mapping,
and mutations that return the complete collection are prohibited.

Collections with an intentional product-domain maximum may remain arrays only
when mutation ingress enforces that same maximum before growth. Available
Projects, active Scheduled definitions, backups, background processes, Database
Properties/Views, and Property options use explicit fixed bounds; archived
history uses windows where it can continue growing. Host compatibility helpers
may assemble several windows only inside one of those proven domain bounds and
must fail if Core returns a continuation beyond it.

Renderer owners consume continuations. Project lists use an infinite query;
sidebar task lanes stay cold while folded and append only on `Show more`;
Database Views append their row window; calendar occurrences carry continuation
through IPC and HTTP under an explicit presentation bound. Page destination
pickers keep only the active Project's first window for an empty query and use
Library v2's bounded Project Page search for cross-Project queries; they do not
fan out one Database View read per Project. Foreground app-server reconciliation
commits one window and returns, while one background sweep continues the catalog
and reconciles absence only after reaching every terminal cursor. Main must not
turn a Core window back into an unbounded interactive response.

## Consequences

Transport overflow is now a protocol-contract failure rather than a normal
capacity signal. Interactive reads stay substantially below the 16 MiB guard,
and latency and memory depend on the requested window instead of total Profile
size. Pagination can return fewer items than requested without implying
completion; only an absent `next_cursor` marks the end.

Cursor formats are disposable read state. They are not persisted, migrated, or
interpreted by renderer code. A Module contract or projection revision can
invalidate them without compatibility shims.

Library children and catalog reads use the same keyset cursor and indexed seek
contract. No offset cursor remains in a production growing-collection read.

## Rejected alternatives

- Raising every client to 64 MiB hides unbounded reads and increases peak memory.
- Compressing or streaming one giant JSON collection preserves the same
  latency, cancellation, and consistency problems.
- A caller-provided byte cap creates divergent product behavior and makes
  response size a client-controlled authority.
- Unsigned JSON/base64 cursors allow query-coordinate tampering.
- Cursor-carried authorization becomes stale and would turn pagination state
  into an access token.
- OFFSET or in-memory slicing does not bound source work.

## Acceptance

An ordinary JSON response larger than the former 512 KiB limit and smaller than
16 MiB succeeds in both Host and native clients. Declared and streamed
responses above 16 MiB fail with a typed response-budget error.

Window tests cover default and maximum counts, encoded multi-byte Unicode,
single-item overflow, count overflow, continuation from the last included row,
signature tampering, query mismatch, Store-epoch rotation, and projection
revision changes. Module-specific acceptance additionally proves that SQL uses
the intended keyset index and that a theoretical legacy full response may
exceed 16 MiB while each returned window remains below 1 MiB.
