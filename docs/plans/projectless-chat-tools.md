# Enable the complete projectless chat toolset

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current while implementation proceeds. This document follows `docs/PLANS.md` and is intentionally self-contained so that a new contributor can resume from this file alone.

## Purpose / Big Picture

Nodex conversations can exist without belonging to a Project. Today those projectless chats expose Browser but hide or reject Side chat and Terminal because several renderer, Main-process, and Rust Core boundaries still treat a Project identifier as the source of execution context and tab ownership. After this change, a projectless conversation that is attached to a Codex thread can open an ephemeral Side chat; if that thread also has a working directory, it can open Terminal. A blank projectless session continues to offer Browser only. Exact files emitted by a projectless thread remain previewable and pinnable, while the generic Files tree remains Project-only.

The visible proof is the right or bottom panel add menu. For a project-backed session its existing action order is unchanged. For a projectless session with an attached thread and working directory it shows Side chat, Browser, then Terminal. If the working directory is absent, it shows Side chat and Browser; starting Side chat repairs and persists the thread workspace before forking. If no thread is attached, it shows Browser only. The command palette, header, slash command, selected-text action, panel buttons, and keyboard shortcuts all use the same eligibility decision.

## Progress

- [x] (2026-07-21 19:02Z) Re-explored the post-merge repository and the readable Codex Electron reference, confirmed the approved behavior and implementation boundaries, and read the applicable repository and UI/React guidance.
- [x] (2026-07-21 19:02Z) Created this ExecPlan and divided implementation into non-overlapping Core, Main, Renderer, and shared-contract workstreams.
- [x] (2026-07-22 03:34Z) Implemented and tested Rust Core schema version 87, tab normalization, and portable Browser/Terminal ownership rewrites without changing the frozen v84 schema.
- [x] (2026-07-22 03:34Z) Made Side chat derive execution context from its parent conversation and repair missing or stale projectless workspaces before forking.
- [x] (2026-07-22 03:34Z) Removed Project identifiers that do not belong in Terminal, Side chat, and tab-create input contracts.
- [x] (2026-07-22 03:34Z) Added one renderer capability resolver and routed menus, commands, header/slash/selection actions, and shortcuts through it.
- [x] (2026-07-22 03:34Z) Removed fake fallback Project identifiers from conversation-stage models and projectless permissions/archive refresh behavior.
- [x] (2026-07-22 03:34Z) Added focused Rust, Main, shared, renderer, pure-helper, workflow, and Storybook coverage.
- [x] (2026-07-22 03:34Z) Updated architecture, product, frontend, reliability, ownership, shortcut, and release documentation.
- [x] (2026-07-22 03:34Z) Ran targeted and handoff checks, resolved contract-test drift and React workflow failures, and prepared the final conventional commit with a clean-worktree requirement.

## Surprises & Discoveries

- Observation: The renderer already permits an exact projectless file to be opened and pinned, but Rust Core still rejects every projectless Files tab.
  Evidence: `openWorkspaceFileTab` in `src/renderer/components/workbench/workbench-shell.tsx` constructs a nullable-owner Files tab, while `normalize_tab_config` in `crates/nodex-core/src/workspace/session_mutation.rs` has a Browser-only null-owner gate.

- Observation: Projectless Terminal is not blocked by the PTY manager itself. The manager accepts a conversation, session, and working directory; the Project field is transported but unused.
  Evidence: `src/main/terminal-manager.ts` does not read `TerminalCreateRequest.projectId`, while `src/renderer/components/kanban/terminal-panel.tsx` forwards it only through renderer types.

- Observation: Side chat already has the required ephemeral lifecycle, including loading, cleanup, expiry recreation, and discard. The gap is context derivation, not lifecycle ownership.
  Evidence: Side-chat tabs live in renderer-local state in `workbench-shell.tsx`; `CodexService.startSideChat` currently requires an input Project only to find a fallback working directory.

- Observation: The Core tab-create adapter already ignores the redundant top-level Project field and sends only the owning Session identifier plus tab data to Rust.
  Evidence: `createProjectSessionTab` in `src/main/core-client/project-workspace-adapter.ts` parses the field but does not include it in the `create_tab` mutation.

- Observation: A projectless parent can contain a non-empty cwd that is no longer usable, so checking only for an empty string is insufficient before Side-chat fork inheritance.
  Evidence: Main tests now cover both a missing cwd and a non-empty unavailable cwd; both pass through `repairPersistedProjectlessWorkspaceForResume` before the fork request.

- Observation: Guarding Terminal only at the Workbench tab renderer still left a component-level path that could attach a PTY with the process default directory.
  Evidence: `TerminalPanel` and `useTerminal` now require and normalize a cwd, render an explicit unavailable state for blank input, and tests prove no terminal attach call occurs.

- Observation: An ephemeral Side-chat child must keep its own explicit nullable Project context even if its parent Session is later rehomed.
  Evidence: `resolveSideChatProjectId` distinguishes an unavailable pre-ready child from a ready child whose `projectId` is explicitly null, with pure and Workbench regression coverage.

- Observation: Raising the store version exposed two integration assertions that still expected v86, plus an unrelated existing lifecycle test race that can observe an empty runtime-descriptor line under parallel Rust tests.
  Evidence: Native Rust and Node client assertions now expect v87. The lifecycle test passes in isolation and the complete workspace passes with `RUST_TEST_THREADS=1`; no production lifecycle code was changed as part of this feature.

## Decision Log

- Decision: Treat Browser and Terminal as portable session-owned tabs; keep Side chat renderer-local and ephemeral; allow Files without a Project only when its config names an exact path.
  Rationale: Browser and active PTY identity belong to the conversation/session and can survive Project reassignment. Side chat is a disposable fork and should not enter durable tab storage. A generic file tree needs Project workspace semantics, but an exact output path is already a bounded resource.
  Date/Author: 2026-07-21 / Codex and user-approved plan.

- Decision: Remove `projectId` from `CodexSideChatStartInput`, `ProjectSessionTerminalTabConfig`, `TerminalCreateRequest`, and `ProjectSessionTabCreateInput` rather than retaining compatibility aliases.
  Rationale: The parent thread and owning Session are authoritative. Retaining duplicate ownership fields would preserve conflicting sources of truth. The only compatibility operation is the one-time v87 migration that strips Terminal config fields already stored on disk.
  Date/Author: 2026-07-21 / Codex and user-approved plan.

- Decision: Use one pure capability resolver that returns both availability and a reason, hide unavailable menu/header actions, disable command-palette entries, and let shortcuts return before `preventDefault` when execution is unavailable.
  Rationale: All entry points must describe and enforce the same behavior. Reasons are useful for command-palette affordances and tests, while hidden compact menus remain uncluttered.
  Date/Author: 2026-07-21 / Codex and user-approved plan.

- Decision: Do not fabricate a fallback Project for projectless conversation surfaces.
  Rationale: The app-server thread, fork, and execution contracts are bounded by thread identity and working directory. A fake Project leaks into permission lookups, navigation paths, archive refresh, and durable ownership, producing incorrect behavior.
  Date/Author: 2026-07-21 / Codex and user-approved plan.

## Outcomes & Retrospective

Implementation is complete. Projectless sessions now expose Side chat, Browser, and Terminal from one capability matrix: an attached thread with cwd receives all three; an attached thread without cwd receives Side chat and Browser; a blank projectless chat receives Browser only. Side chat remains renderer-local and ephemeral, Terminal and Browser are portable durable tabs, and exact projectless Output files can be pinned without enabling the generic Files tree.

Core v87 migrates v85/v86 stores with a pre-migration backup, transactionally rebuilds tab ownership, strips legacy Terminal Project fields, preserves tab/layout/state data, and validates fresh/v84/v85/v86 convergence. Main repairs both missing and stale projectless workspaces before Side-chat fork. Renderer conversation surfaces carry honest nullable Project context and Terminal never falls back to process/home cwd.

All focused suites passed: shared schemas (6), Main Codex service (193), Workbench/Terminal/capability helpers (134), nullable conversation surfaces (223), and page-stage ownership regression (43). Final `core:fmt`, `core:clippy`, `core:protocol:verify`, `typecheck`, `lint`, and `pnpm test` passed; `pnpm test` covered 1,415 Node, 946 Main, 3,076 Renderer, and 46 Integration tests with no React `act(...)` warning. The complete Rust workspace also passed with `RUST_TEST_THREADS=1`. The unmodified parallel Core gate intermittently hit the pre-existing `incompatible_idle_core_drains_before_a_replacement_starts` empty-descriptor race; its exact and complete lifecycle-file reruns passed, so no unrelated lifecycle change was folded into this feature.

No product work was deferred. The remaining activity is the user-performed visual pass described below; repository guidance explicitly omits Playwright for this UI change.

## Context and Orientation

Nodex is an Electron application. The renderer in `src/renderer` presents conversations and workbench panels. The Main process in `src/main` owns local services such as Codex app-server integration and PTY terminals. The detached Rust Core in `crates/nodex-core` is the exclusive owner of the SQLite workspace store. Shared TypeScript transport contracts live in `src/shared`.

A Project is a named Nodex workspace. A projectless session is a durable `ProjectSession` whose `projectId` is null. A session may be attached to one Codex thread, which supplies conversation identity, working directory (`cwd`), and projectless output/browser roots. A durable workbench tab is a row in Core's `project_session_tabs`; its `project_id` mirrors the owning Session for Project-scoped tabs. A portable tab is one that can remain meaningful when a Session moves between Project and projectless ownership. In this feature Browser and Terminal are portable. Side chat is not a durable tab: it is an ephemeral renderer-local child thread forked from the attached parent conversation.

The database currently begins from the frozen `crates/nodex-core/schema/v84.sql` snapshot, then Rust applies forward migrations from `crates/nodex-core/src/infrastructure/migration.rs`. Never edit the frozen snapshot. Version 87 must rebuild `project_session_tabs` because SQLite cannot directly alter its owner check constraint. Migration backups protect existing version 85 and 86 stores, and the rebuild must be transactional so a failure leaves the original database usable.

The renderer's central integration point is `src/renderer/components/workbench/workbench-shell.tsx`. It currently defines panel actions, constructs durable tab drafts, starts Side chats, dispatches shortcuts and command-palette actions, renders Terminal panels, and synthesizes the conversation surface. The new pure helper belongs under `src/renderer/lib/workbench-panel-capabilities.ts`, with action availability based on Project ownership, attached-thread state, a non-empty thread `cwd`, target panel, and singleton tabs already open. The existing visual menu chrome should not change.

At the start of this work, conversation stage contracts in `src/renderer/features/local-conversation/thread-stage-types.ts`, `connected-thread-stage.tsx`, the body owner, body, and composer required a string Project identifier even though downstream permission APIs already understood null. These types now honestly carry `string | null`. A projectless composer consumes the manager's default permission state and never sends `codex:permission:state:get(null)`.

## Plan of Work

First, add Core schema version 87 in `crates/nodex-core/src/infrastructure/schema.rs` and `migration.rs`. The forward migration transaction creates a replacement `project_session_tabs` table with the same columns and constraints except that Browser, Terminal, and Files rows may have null Project ownership. Copy every row and column, including JSON config/state, order, timestamps, and layout-related identifiers. While copying Terminal rows, remove `$.projectId` from JSON config. Swap tables, recreate the session-order, Project, and browser-identity indexes, then publish metadata and `PRAGMA user_version` as 87. Fresh stores and imports of v84, v85, and v86 must converge on the same validated v87 inventory; upgrading v85 or v86 creates a migration backup before changes.

Next, update Core tab normalization in `crates/nodex-core/src/workspace/session_mutation.rs`. Browser accepts null ownership. Terminal validates exactly a non-empty `terminalSessionId`. Files retains its Project-backed behavior; under null ownership it requires an explicit non-empty `path` and preserves `projectId`, `hostId`, `workspaceRoot`, `cwd`, and `path`. Database View, Page Stage, and Review explicitly reject null ownership. Replace Browser-only movement checks in `session_lifecycle.rs` and `sidebar.rs` with a common portable-tab predicate and ownership rewrite. A Session or thread can cross ownership only when it has no tabs or every tab is Browser/Terminal. Both Project-to-null and null-to-Project update tab row ownership. Browser config receives the new Project value; Terminal config does not.

In shared TypeScript contracts, remove `projectId` from Terminal tab config and create request, Side-chat start input, and top-level tab-create input. Update Zod schemas so Terminal parsing strips unknown legacy fields and emits only `terminalSessionId`; Core owns the durable migration. Update all transport callers and behavior tests. No Codex app-server or generated Rust protocol schema changes are expected because durable tab config remains opaque JSON at that boundary.

In `src/main/codex/codex-service.ts`, make `startSideChat` load and validate the parent detail first and derive Project, cwd, writable roots, output root, and browser root from it. Keep the side-of-side guard. A Project parent with no cwd uses that Project's root. A projectless parent with no cwd calls the existing `repairPersistedProjectlessWorkspaceForResume`, persists the repaired context, reloads or recomputes inheritance, and only then sends the fork request. Failure to repair returns a clear error before creating a child. Update `prepareWorkspaceThreadProjectAssignment` so an empty session or a session containing only Browser/Terminal can be atomically rehomed rather than detached and archived.

In the renderer, add the capability resolver and use it in the right and bottom add menus, empty panel, command palette, header action, `/side`, selected-text action, and both global and panel shortcuts. Put execution behind one dispatcher. Unavailable keyboard actions return before suppressing the key. Project-backed action order remains the existing order; projectless order is Side chat, Browser, Terminal. Construct a projectless Terminal only when an attached thread has a non-empty cwd, and send the exact cwd plus conversation and Project-session identities. Remove Project from Terminal panel and hook props. Keep exact-file Output opening on its dedicated path so it can create and later pin a projectless Files preview even though generic Files is unavailable.

Finally, change all conversation-stage Project identifiers to `string | null` and delete the conversation surface's `fallbackProjectId` and `surfaceProjectId`. Projectless Side-chat navigation is `session:<id>/thread:<id>`, never `project:null`. A blank projectless composer uses the Session identity, or `projectless:new-thread` without a Session. Projectless permission reads use the existing default state; archive/unarchive refreshes projectless summaries instead of loading an arbitrary Project. Add focused tests and a Storybook story for an attached projectless session, update source-of-truth documentation, and run the validation suite.

## Concrete Steps

All commands run from `/Users/asc/repo/nodex3`.

During implementation, run focused checks near the changed boundary:

    cargo test -p nodex-core infrastructure::migration
    cargo test -p nodex-core workspace
    pnpm exec vitest run --config vitest.node.config.ts src/shared/schemas/project-sessions.test.ts
    pnpm test:main src/main/codex/codex-service.test.ts
    pnpm exec vitest run --config vitest.renderer.config.ts src/renderer/components/workbench/workbench-shell.layout-panel-actions.test.tsx src/renderer/components/workbench/workbench-shell.panel-commands.test.tsx

When the edit set is stable, run:

    pnpm run core:fmt
    pnpm run core:clippy
    pnpm run core:test
    pnpm run core:protocol:verify
    pnpm run typecheck
    pnpm run lint
    pnpm test

Every command should exit zero. The React suites must emit no `act(...)` warning, and `core:protocol:verify` must show no generated-contract drift. This is not a full release gate, so `pnpm test:all` and Playwright are intentionally omitted. After checks, create one conventional commit with subject `feat(workbench): enable projectless chat tools` and a body explaining the v87 ownership migration, conversation-native Side chat/Terminal context, unified resolver, tests, and documentation.

## Validation and Acceptance

Automated Core tests must prove that v86 upgrades create a backup, preserve every tab/layout/state field, and strip legacy Terminal Project fields; fresh/v84/v85/v86 stores must publish an equivalent v87 schema. Creating a null-owner Terminal with only `terminalSessionId` and an exact-path Files tab must succeed. A null-owner generic Files, Database View, Page Stage, or Review tab must fail with a kind-specific error. Browser+Terminal sessions must move both directions between Project and projectless ownership without changing tab/session identity, while any Project-scoped tab blocks both MoveSession and MoveThread.

Main and shared tests must prove that projectless Side chat needs no fake Project, inherits cwd and projectless roots, remains ephemeral, repairs a missing cwd before forking, and fails before fork when repair fails. Project-backed Side chat remains unchanged. Terminal and tab-create parsed payloads contain no duplicate Project field.

Renderer tests must cover the complete capability matrix and prove every entry point reads the same resolver. Side chat lifecycle tests cover loading, ready, close/discard, failed cleanup, expired recreation, and projectless navigation. Terminal creation must carry the precise parent-thread cwd, conversation id, and Session id. Pinning an exact projectless Output file must survive a Core snapshot. Storybook must contain an attached projectless Session scenario for human visual review.

For manual acceptance, start the app with `pnpm run dev`. Open a projectless chat whose thread has a cwd and confirm both panel add menus show Side chat, Browser, Terminal in that order. Open Terminal and run `pwd`; it must equal the thread cwd. Open and close Side chat; the parent must not navigate away, the child must not appear in the sidebar, and restarting must not restore it. Open a file from Output, pin it, navigate away and back, and confirm the tab persists. Reassign a session containing only Browser/Terminal to a Project and confirm identities remain. Open a blank projectless chat and confirm only Browser is offered. Per repository guidance, the user performs this visual interaction pass; no Playwright run is required.

## Idempotence and Recovery

The v87 migration is transactional and version-gated. Reopening an already-v87 store performs exact validation without rebuilding it. A v85 or v86 upgrade creates a migration backup before mutation; if rebuilding or validation fails, the transaction rolls back and the original database plus backup remain available. Tests use disposable stores and can be rerun safely.

Source edits and formatting commands are repeatable. If an integration test exposes a partial contract migration, search for the removed field names, update the remaining caller, and rerun the narrow suite before broad checks. Do not edit or regenerate `crates/nodex-core/schema/v84.sql`. Do not delete user worktree changes. The final commit occurs only after the worktree diff has been reviewed and all relevant checks pass.

## Artifacts and Notes

The official Codex app-server contract models execution through threads, forks, and working directories; it has no Nodex Project concept. The readable Electron reference likewise exposes Side chat, Browser, and Terminal from conversation context. Nodex retains its own stronger rule that generic Files, Database View, Page Stage, and Review need a Project, while exact file resources are portable.

Expected capability examples are:

    Project-backed session: existing action set and order
    Projectless + thread + cwd: Side chat, Browser, Terminal
    Projectless + thread, no cwd: Side chat, Browser
    Projectless, no thread: Browser
    Projectless exact Output file: preview and pin through the resource opener

## Interfaces and Dependencies

No dependency is added. Existing SQLite JSON functions perform the one-time Terminal config cleanup. Existing Codex app-server calls perform parent thread reads and forks. Existing PTY infrastructure creates and preserves terminals.

At completion, the relevant public TypeScript shapes are:

    interface CodexSideChatStartInput {
      parentThreadId: string;
      parentNavigationPath?: string | null;
      ...optional prompt and model controls...
    }

    interface ProjectSessionTerminalTabConfig {
      terminalSessionId: string;
    }

    interface TerminalCreateRequest {
      sessionId: string;
      conversationId?: string | null;
      projectSessionId?: string | null;
      cwd?: string | null;
      size: TerminalSize;
      ...optional backend and title...
    }

    interface ProjectSessionTabCreateInput {
      sessionId: string;
      panelId: PanelId;
      ...tab identity, kind, title, and config...
    }

The renderer capability helper returns one result per action with an `available` boolean and an optional domain reason. It is pure: it receives Project ownership, attached-thread and cwd state, panel placement, and existing singleton tabs, and performs no IPC or rendering.

Revision note (2026-07-21): Initial implementation plan created from the user-approved post-merge design. It records repository evidence discovered during re-exploration and the exact validation/rollback contract needed for implementation.

Revision note (2026-07-22): Marked implementation complete, recorded stale-workspace, terminal-cwd, child-context, schema-assertion, and Rust lifecycle-test discoveries, and added final automated validation outcomes before commit.
