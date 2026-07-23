# Legacy Profile fixtures

These databases are deterministic, synthetic release-inventory fixtures generated from the historical Nodex schema and migration builders at source commit `db1e660c907cc41db38d9cc126d385f0826aee78`. The earlier v57 fixture freezes the other supported v57 physical inventory and adds synthetic `card_stage`, Thread, recoverable Page-toggle, cross-Project and unresolved Page references, inline Database View, overlapping option-token, and opaque Session-state rows for named-column and compatibility-overlay migration coverage. They contain no user Profile data.

Keep them byte-for-byte stable. The Rust migration tests validate their complete normalized SQLite inventories before invoking the frozen migrator, then prove v89 publication, source backup retention, semantic v57 conversion, and idempotent reopen.

| Fixture | SHA-256 |
| --- | --- |
| `v26.db` | `cec6e1732e04634399910cbae7116ea3817fb0d707ca45628b485025ed4c06f0` |
| `v57-early.db` | `8e2ea303b0486168ae44ac1c775fa1cc75bb35e21b0fa01b2f7395e42e7fbb2b` |
| `v57.db` | `65f1765d6721a64371e44fe563f384559906001d31e413ea557c4650adf64eed` |
| `v68.db` | `543fc39a2cb3c1d6994afb60f6cdf8701e2f60811732450edc08754f77b6915a` |
| `v82.db` | `cde7a93d904e75736f9d2bea45554f4c5835504565663ae10086801f6b014dea` |
| `v83.db` | `d3c80e2e8bf5375bb4224a5acd91ba74ee9adc0fae6dc9a3b8b54de039911f7c` |
