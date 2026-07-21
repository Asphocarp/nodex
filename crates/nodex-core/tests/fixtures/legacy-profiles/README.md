# Legacy Profile fixtures

These databases are deterministic, synthetic release-boundary fixtures generated from the historical Nodex schema and migration builders at source commit `db1e660c907cc41db38d9cc126d385f0826aee78`. They contain no user Profile data.

Keep them byte-for-byte stable. The Rust migration tests validate their complete normalized SQLite inventories before invoking the frozen migrator, then prove v86 publication, source backup retention, and idempotent reopen.

| Fixture | SHA-256 |
| --- | --- |
| `v26.db` | `cec6e1732e04634399910cbae7116ea3817fb0d707ca45628b485025ed4c06f0` |
| `v57.db` | `65f1765d6721a64371e44fe563f384559906001d31e413ea557c4650adf64eed` |
| `v68.db` | `543fc39a2cb3c1d6994afb60f6cdf8701e2f60811732450edc08754f77b6915a` |
| `v82.db` | `cde7a93d904e75736f9d2bea45554f4c5835504565663ae10086801f6b014dea` |
| `v83.db` | `d3c80e2e8bf5375bb4224a5acd91ba74ee9adc0fae6dc9a3b8b54de039911f7c` |
