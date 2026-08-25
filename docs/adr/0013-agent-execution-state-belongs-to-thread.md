# ADR 0013: Agent execution state belongs to Thread

- Status: Accepted
- Date: 2026-07-15
- Owners: Nodex maintainers
- Supersedes: Agent-state portions of ADR 0003

## Context

Cards historically carried `agent.blocked` and `agent.status` as seeded intrinsic Block properties. Their Card fields and UI controls looked authoritative even when no agent was running, while actual execution already belonged to Codex Threads and project sessions. Keeping both representations created dummy defaults, stale status, and two competing ownership models.

## Decision

Live Agent execution state belongs to the durable Codex Thread, its project-session owner, and the Codex runtime. It is not content, Card metadata, or generic Block state.

Cards retain execution intent such as run-target configuration, but no longer expose Agent blocked/status fields through Card contracts, read models, Card Stage, board views, search, CLI commands, or creation/import/transfer paths. The retired intrinsic keys are rejected by the generic Block-property mutation boundary rather than accepted as unknown custom properties.

Schema v63 removes live `agent.blocked` and `agent.status` authority rows and rebuilds Card read projections without advancing Card metadata revisions or creating change-log events. Immutable mutation and history evidence remains intact.

This decision does not add a derived Thread-status replacement to Card UI. Thread status, blocked runtime requests, background subagent state, and conversation summaries retain their existing Thread/runtime contracts.

## Consequences

- A Card describes durable work and execution configuration without claiming to represent a live agent.
- Thread/session runtime is the sole authority for execution progress and blocking state.
- Old Card Agent values disappear during v63 migration and cannot be recreated through public property mutation APIs.
- Future Card surfaces that need execution state must read an explicit Thread-derived view model rather than restore Card properties.
