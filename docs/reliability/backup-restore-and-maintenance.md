# Backup, Restore, and Maintenance

## Backup boundary

A whole-Store backup contains the SQLite database and managed assets from one
Core Administration boundary. Core drains admitted writes and asset
materialization, blocks new Store work, flushes/validates authority, and creates
the snapshot through SQLite's online backup mechanism while the asset closure is
stable.

The staged database, asset files, manifest, and their directories are fsynced
before the backup is published. After the complete SQLite integrity,
foreign-key, schema, and invariant validation succeeds, the current manifest
records that evidence version together with the database SHA-256 and a
deterministic digest over every asset path, length, and byte. Backup identity
and result are receipt-backed; retention starts only while the same Core
authority remains active. Restore still performs its own strict
installed-candidate validation.

Manual and scheduled backups use the same operation. Automatic interval and
retention are Profile settings described in [Configuration](../CONFIGURATION.md).
The UI reports environment-managed values without pretending to overwrite them.

## Restore preflight

Restore is explicit and exclusive. Its optional safety backup is created after
the same Store/asset fence is acquired and before replacement, with no reopened
write window between those operations.

Core rejects a candidate unless it passes:

- exact supported Store schema and authority metadata;
- SQLite integrity and foreign-key checks;
- Block ownership and document-bearing owner invariants;
- ready Document/head/projection consistency;
- a complete managed-asset closure containing only safe flat regular files;
- no symlink, unsafe filename, missing referenced asset, or unknown object.

## Journaled replacement

Database, WAL, and assets are one recoverable replacement. Core records and
fsyncs a replacement journal before moving live/staged pieces. Every rename and
parent directory is fsynced. Startup recovery either restores the complete
previous authority or finishes the complete new authority; it never mixes
database and asset generations.

After installation, Core rotates the Store epoch transactionally, invalidates
subscriptions and process-local leases, and returns a committed receipt. A
missing Host response cannot turn that durable success into failure. Electron
then relaunches so every Adapter binds the new authority.

Pre-restore renderer checkpoints, outboxes, Awareness, stream cursors, and
Document sessions fail closed on the new epoch. Surfaces remount from current
descriptors and canonical content; no old local edit can replay into the
restored Store.

## Development Profile clones

Offline development provisioning may materialize a current evidence-backed
published backup into a new Profile home. The source Profile remains unopened:
Core reads only the backup package, copies `nodex.db` and its managed-asset
closure into a private sibling staging directory, and rejects symlinks,
existing targets, or source/target ancestry overlap. Regular-file copying uses
the platform's clone-or-copy primitive, which prefers APFS CoW on same-volume
macOS and falls back safely elsewhere. The copy preserves Profile, Library,
content, history, Project identities, and the imported Store epoch for
production-shape fidelity while reminting the Agent token key and automation
jitter salt. It is an isolated local fork: post-clone history may diverge under
the imported coordinates and is never merged, synchronized, or replayed into
its source.

Core verifies the copied database and asset-tree digests before reminting, then
validates schema/epoch identity, document authorities, every present managed
asset, and missing-asset evidence without repeating the publication-time SQLite
integrity scan. It writes and syncs the private `profile-snapshot.json` receipt,
then atomically renames the staging directory into place. Because the staging
tree is disposable and exactly reproducible, development cloning omits
per-file fsync for the copied database/assets while retaining receipt and
directory publication syncs. A power-loss-damaged fork must be deleted and
recreated from its unchanged backup. Failed provisioning removes only the owned
staging directory and never modifies the source backup. This is a local
development input path, not a restore into a running Profile.

## Maintenance

Core Administration orders integrity checks, foreign-key checks, Document
compaction, revision retention, deleted-Block collection, and incremental
vacuum through one maintenance coordinator. Callers request intent, not an
arbitrary sequence of storage operations.

Maintenance is idempotent where possible and reports typed partial/deferred
outcomes. It never rewrites immutable receipts or mutation history and never
removes pinned revisions. A risky migration or large maintenance operation
should begin from a labeled manual backup.

Online maintenance does not hold the serialized writer for a complete pass.
Block collection first plans a globally bounded set of the oldest eligible
tombstones and loads its fail-closed evidence once through a consistent WAL
reader snapshot, then processes short
candidate slices through separate writer commands. Each writer slice checks the
snapshot's LocalCommit fence, and each candidate still commits atomically;
interruption or an intervening product commit may leave earlier candidates
collected, and replaying the same receipt-backed operation safely converges from
a fresh plan before the final receipt is written. Request-class scheduling can
run queued interactive work between those slices, while aging guarantees
maintenance eventually receives another slice.

## Recovery evidence

Backup/restore tests exercise interruption at each journal phase, invalid
assets, corrupted databases, epoch rotation, and stale-client rejection. Current
schema values, journal filenames, and physical steps belong to the
Administration implementation and tests rather than this contract.
