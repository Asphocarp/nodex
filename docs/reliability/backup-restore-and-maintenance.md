# Backup, Restore, and Maintenance

## Backup boundary

A whole-Store backup contains the SQLite database and managed assets from one
Core Administration boundary. Core drains admitted writes and asset
materialization, blocks new Store work, flushes/validates authority, and creates
the snapshot through SQLite's online backup mechanism while the asset closure is
stable.

The staged database, asset files, manifest, and their directories are fsynced
before the backup is published. Backup identity and result are receipt-backed;
retention starts only while the same Core authority remains active.

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

## Maintenance

Core Administration orders integrity checks, foreign-key checks, Document
compaction, revision retention, deleted-Block collection, and incremental
vacuum through one maintenance coordinator. Callers request intent, not an
arbitrary sequence of storage operations.

Maintenance is idempotent where possible and reports typed partial/deferred
outcomes. It never rewrites immutable receipts or mutation history and never
removes pinned revisions. A risky migration or large maintenance operation
should begin from a labeled manual backup.

## Recovery evidence

Backup/restore tests exercise interruption at each journal phase, invalid
assets, corrupted databases, epoch rotation, and stale-client rejection. Current
schema values, journal filenames, and physical steps belong to the
Administration implementation and tests rather than this contract.
