# Paid Agent smoke tests

Paid Agent smoke tests are local, explicit canaries for the boundary between a
real subscription-backed Agent and Nodex's production Electron composition.
They are not part of CI, release certification, or the ordinary deterministic
E2E suite.

## Running one case

The word `paid` in the command is the quota authorization. No additional
environment-variable gate is required. Every invocation must select exactly
one case:

```bash
vp run agent:smoke:paid --case file
vp run agent:smoke:paid --case browser
vp run agent:smoke:paid --case subagent
```

The runner rejects unknown arguments before staging or building anything. It
also refuses CI, forces one Playwright worker with no retries, verifies that a
source Codex `auth.json` exists, prints its absolute source path together with
the selected execution profile and maximum logical Agent executions, stages
the real Agent and Browser runtimes, then builds Core and Electron before
launching the case.

The source credential defaults to `~/.codex/auth.json`; `CODEX_HOME` may point
at another source Codex home. Only authentication is copied into a disposable
Profile; user MCP servers, shell environment policy, and other portable config
are deliberately excluded. Never point Nodex development directly at a live
Profile.

## Case contract

| Case       | Exact profile                     | Maximum logical executions | Unique boundary                                                                      |
| ---------- | --------------------------------- | -------------------------: | ------------------------------------------------------------------------------------ |
| `file`     | GPT-5.6 Luna / Max / Standard     |                     1 root | Real provider → file or shell tool → exact owned bytes → canonical thread/UI         |
| `browser`  | GPT-5.6 Luna / Max / Standard     |                     1 root | Real provider → Browser Use/IAB → loopback HTTP fixture → canonical MCP item/UI      |
| `subagent` | GPT-5.6 Terra / Medium / Standard |           1 root + 1 child | Real provider → one child → child filesystem result → bounded topology Done state/UI |

“Logical execution” means a root or child Agent execution. Tool loops may make
multiple upstream provider requests, so the table is not a promise about the
provider's internal request count.

Before Send, every case refreshes the runtime catalog and fails unless the
OpenAI credential, exact visible model, exact reasoning effort, and Standard
service tier are available. It selects the profile through the real Composer
UI, verifies the stored selection, refreshes the catalog again, and never
falls back to another model. After completion it cross-checks the durable
thread profile and an allowlisted rollout summary against that selection.

## Evidence and cleanup

Each run writes beneath:

```text
runs.local/paid-agent-smoke/<UTC timestamp>-<case>/
```

The result contains Playwright trace-on-failure data plus a final screenshot,
bounded runtime logs, and `evidence.json`. The JSON evidence includes only
allowlisted execution facts: case, expected and resolved profile, thread
identities, logical-execution limit, duration, tool/status facts, and
case-owned hashes or topology. It does not copy authentication, full rollout
files, or user Profile data. The screenshot, trace, or runtime log may contain
the synthetic canary prompt and its random markers; treat the artifact folder
as local test evidence.

Even on failure, the harness extracts evidence and independently removes the
copied credential before disposing the rest of the Profile. If broader cleanup
must retain a diagnostic Profile, it contains no `auth.json`. A paid case never
retries or resends a prompt automatically.

## Why this is not a seed Profile or a skill

Scenario seeds own authoritative product data. The Agent execution profile is
a runtime catalog choice stored by the Composer, so encoding Luna or Terra in
a Core seed would create a second, misleading authority. The dedicated runner
is the reusable entry point: it owns consent, cost bounds, runtime staging,
case selection, and artifacts in one place. A separate skill would only wrap
the same command and make authorization less obvious.

For ordinary UI iteration, continue to use deterministic seeded/fake-runtime
E2E. Run a paid canary only when the real provider boundary is the evidence
under review.

## Nodex CLI case — TBD, not runnable

A future CLI canary should ask the Agent to invoke the packaged `nodex` binary
through a real shell, route it to the same disposable Profile and Project, use
a stable JSON command to read a pre-seeded nonce or perform one owned semantic
mutation, observe the same result through Core/UI, and clean it up.

Do not add a skipped Playwright case or a runnable `nodex-cli` enum value until
all of these are settled: packaged-binary discovery, child `PATH` and
`NODEX_HOME` routing, the stable `--json` command, same-Core concurrency
semantics, and deterministic mutation cleanup.
