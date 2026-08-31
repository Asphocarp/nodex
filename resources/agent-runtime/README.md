# Agent runtime supply chain

`openinterpreter.lock.json` is the complete source and artifact contract for
Nodex's primary app-server. It deliberately separates three identities:

- `source.repository` and the full `source.commit` identify the immutable
  upstream tree;
- ordered `source.patches` identify every reviewed local build correction by
  repository path, packaged evidence path, and SHA-256;
- `release.repository` and `release.tag` identify the immutable dual-architecture
  archives consumed by development, CI, and packaging.

The lock also binds every archive's size and SHA-256, the staged metadata hash,
the package layout, third-party notices, and the generated experimental
app-server schema fingerprint. A runtime upgrade is incomplete until both macOS
architectures pass staging and the app-server conformance probes.

Normal installs carry no parallel official Codex npm package or protocol
snapshot. When `codexCompatibilityVersion` changes, rebuild and relock the Open
Interpreter artifacts, regenerate the committed protocol package from that
runtime, and run `vp run verify:runtime:mac`.

Multi-agent candidates must additionally prove their resource and commit
boundaries. The conformance closure covers effective V2 tool exposure, mailbox
count/byte admission, atomic execution and residency limits, initial-task spawn
rollback, durable and idempotent completion delivery across parent unload and
process restart, nested depth, eviction and reload, and provider transport
parity. Generated V2 unions or a compatibility version alone are not acceptance
evidence.

## Upgrade procedure

Prefer an immutable upstream Open Interpreter release when its tag resolves to
the reviewed source commit and it publishes both required macOS package
archives. Verify each package manifest, required artifact, archive size and
SHA-256, then update the lock and stage both architectures. Keep
`source.patches` empty when the release already contains every required fix.

Build and publish a Nodex-owned runtime only when the reviewed source needs a
local patch or upstream does not provide the required package closure.

Clone `source.repository` into a disposable directory, detach at the exact
`source.commit`, verify the clean tree, then apply `source.patches` in listed
order with `git apply`. Use Python 3.10 or later and the upstream package
builder once per target:

```bash
python3 scripts/build_codex_package.py \
  --target aarch64-apple-darwin \
  --variant open-interpreter \
  --cargo-profile release \
  --package-dir <arm64-package-directory> \
  --archive-output <arm64-archive> \
  --force

python3 scripts/build_codex_package.py \
  --target x86_64-apple-darwin \
  --variant open-interpreter \
  --cargo-profile release \
  --package-dir <x64-package-directory> \
  --archive-output <x64-archive> \
  --force
```

Before packaging, validate the patched source from `codex-rs`. The focused
tests are part of the source overlay so the mailbox, spawn transaction, and
completion-delivery policies remain reviewable independently of the desktop
adapter:

```bash
cargo check -p codex-core --lib
cargo check -p codex-app-server --lib -p codex-tui -p codex-acp-server -p codex-cli --bin codex
cargo test -p codex-state multi_agent_v2_completion_ -- --nocapture
cargo test -p codex-core --lib multi_agent_v2 -- --test-threads=1
cargo test -p codex-core --lib mailbox_rejects -- --test-threads=1
cargo test -p codex-core --lib failed_initial_mail_rolls_back_spawn_registry_residency_and_edge -- --test-threads=1
cargo test -p codex-core --lib completion_delivery_retries_mailbox_backpressure_until_capacity_recovers -- --test-threads=1
cargo test -p codex-core --lib successful_completion_message_stays_below_mailbox_budget -- --test-threads=1
cargo test -p codex-core --lib failed_spawn_reservation_releases_nickname_without_resetting_pool -- --test-threads=1
cargo test -p codex-core --lib ensure_v2_agent_loaded_reloads_registered_unloaded_agent -- --test-threads=1
cargo test -p codex-core --lib ensure_v2_child_loaded_preserves_evicted_parent_authority -- --test-threads=1
cargo test -p codex-core --lib residency_slot_reservation_unloads_oldest_idle_v2_agent -- --test-threads=1
cargo test -p codex-core --lib interrupted_v2_agent_is_lost_after_residency_eviction -- --test-threads=1
cargo test -p codex-core --lib execution_guards_count_active_v2_subagent_turns -- --test-threads=1
cargo test -p codex-core --lib subagent_activity_emits_matching_start_and_completion -- --test-threads=1
cargo test -p codex-core --lib multi_agent_v2_interrupted_agent_stays_resident_listed_and_accepts_followup -- --test-threads=1
```

Update the lock from the resulting regular files, stage each local archive, and
run the schema and runtime gates before publication. `vp run
test:agent-runtime-conformance` includes a packaged-binary semantic scenario,
not just schema/tool exposure: it exercises spawn rollback, byte admission,
send/followup/interrupt/list/wait, nested direct-parent completion, interrupted
reuse, residency eviction/reload, process-restart completion replay, and
lifecycle cleanup against a mock provider. Durable completion receipts are
acknowledged only after the parent rollout flush succeeds and the exact stable
receipt ID can be read back from that rollout; mailbox enqueue or in-memory
history by itself is never considered delivery.
Create and push the exact
artifact tag at the reviewed Nodex commit, then publish through the guarded
interface:

```bash
vp run agent-runtime:publish -- \
  --repo <owner/repository> \
  --tag <agent-runtime-vX.Y.Z-8-char-source-commit> \
  --source-commit <40-char-source-commit> \
  --arm64 <arm64-archive> \
  --x64 <x64-archive>
```

The publisher always uses `--verify-tag --latest=false`. After publication,
delete the local download cache, restage from the locked HTTPS URLs, and rerun
`vp run verify:runtime:mac` so the shipped path is tested rather than only the
build directory.
