# Remediate every audited renderer test boundary

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must remain current while work proceeds. This document follows `docs/PLANS.md`.

## Purpose / Big Picture

Nodex's renderer suite protects important navigation, ownership, editor, conversation, and failure-recovery behavior, but too many combinations currently pay for a complete React, jsdom, Provider, portal, and WorkbenchShell mount. After this work, each of the 35 slow files and two additional slow single tests identified in `notes.local/2026-08-21-renderer-ci-slow-test-value-audit.zh-CN.md` will have an explicit disposition backed by code and timing evidence. Business rules will be exercised through their owning deep Module Interface in Node where possible; jsdom will remain only where focus, selection, portal, lifecycle, or real React effect behavior is the contract.

The observable result is a renderer suite that preserves or strengthens behavior coverage, has no React `act(...)` or Suspense warnings, and no longer uses full-shell mounts for repeated rule matrices already owned by a pure Module. The audit report will contain a row-by-row before/after ledger, and PR CI plus an explicit full run will pass on the final commit.

## Progress

- [x] (2026-08-21 05:17Z) Confirm the branch is directly based on the latest `origin/main`, read repository architecture and testing rules, and retrieve current Vitest 4.1 documentation.
- [ ] Record three targeted baseline samples for all 37 audited items and identify each file's slow cases on the current PR tree.
- [ ] Remediate `workbench-shell.layout-panel-actions.test.tsx`.
- [ ] Remediate `workbench-shell.pages-shell-navigation.test.tsx`.
- [ ] Remediate `workbench-shell.automations-conversation.test.tsx`.
- [ ] Remediate `workbench-shell.panel-commands.test.tsx`.
- [ ] Remediate `workbench-shell.sidebar-projects.test.tsx`.
- [ ] Remediate `workbench-shell.sidebar-core.test.tsx`.
- [ ] Remediate `workbench-shell.routes-threads.test.tsx`.
- [ ] Remediate `workbench-shell.project-agent-dock.test.tsx`.
- [ ] Remediate `workbench-shell.owner-panel-commands.test.tsx`.
- [x] (2026-08-21 04:29Z) Isolate the heavy child-editor seams in `data-source-page-property-context-menu.test.tsx`, `date-property-editor.test.tsx`, and `date-mention-chip.test.tsx`, and add focused real-calendar tests.
- [ ] Remediate the remaining actionable P1/P2 files: `review-diff-panel`, `connected-thread-stage`, `thread-floating-summary-panel`, `nfm-text-action-menu`, `local-conversation-thread-body`, `local-conversation-turn-entry`, `local-conversation-footer`, `page-create-dialog`, `project-edit-dialog`, `local-conversation-request-cards`, `left-sidebar-projects-section`, `database-view-page-context-menu`, `workspace-files-panel`, `local-environments-settings-page`, `local-conversation-composer-shell`, `nfm-side-menu`, and `library-resource-actions`.
- [ ] Remediate the two exceptional single tests in `codex-pending-request-card.test.tsx` and `workbench-settings-overlay.licenses.test.tsx`.
- [ ] Re-measure and explicitly accept the efficient P3 suites without speculative refactors: `local-conversation-thread-composer-speed`, `database-view-surface`, `local-conversation-store`, `app-shell-tabs`, `browser-sidebar-panel`, and `local-conversation-block-leaves`.
- [ ] Update the row-by-row audit ledger with the owning Module, retained DOM contract, before/after median, and exact replacement coverage for all 37 items.
- [ ] Run targeted tests, changed-file lint, typecheck, three final targeted timing samples, a local full renderer suite, PR CI, and an explicit GitHub full matrix.
- [ ] Rebase onto `origin/main` if it advances, resolve every review thread, and leave PR #72 non-draft, clean, and confidently mergeable.

## Surprises & Discoveries

- Observation: The first implementation found that most proposed Workbench and automation pure Modules already existed; the expensive duplication remained in Shell-level matrices and Motion exit trees.
  Evidence: existing Node tests include `src/renderer/lib/workbench-panel-placement.node.test.ts`, `src/renderer/lib/project-agent-dock-controller.node.test.ts`, and `src/renderer/components/workbench/workbench-automation-draft.node.test.ts`.
- Observation: A `3 regular + 1 serialized Workbench worker` experiment was slower than the shared four-worker pool and was reverted.
  Evidence: GitHub run 32446291531 exceeded seven minutes before cancellation, while the shared pool completed.
- Observation: GitHub-hosted runner CPU time varies materially even for the same source tree.
  Evidence: complete renderer samples on the existing PR tree ranged from 226.46s to 315.31s; therefore acceptance uses three-sample medians and reports the range.

## Decision Log

- Decision: Use seam replacement, not test deletion or a global scheduler change.
  Rationale: The audited behaviors are mostly valuable. Moving rule matrices to their owning pure Module preserves behavior while eliminating repeated UI setup; global pool changes did not address ownership and performed worse in CI.
  Date/Author: 2026-08-21 / Codex on behalf of Jun.
- Decision: Count a P3 item as remediated only after a fresh timing sample confirms that its cost is proportional to meaningful coverage and no uncontrolled wait is present.
  Rationale: Thorough remediation does not mean rewriting efficient tests for cosmetic consistency. It means every item has evidence and an explicit long-term boundary decision.
  Date/Author: 2026-08-21 / Codex on behalf of Jun.
- Decision: Keep jsdom for focus, selection, portal, Browser/WebView lifecycle, React effects, and one representative wiring flow per owner/entry category; move pure decisions and matrices to Node.
  Rationale: This follows the runtime that owns the behavior and avoids shallow test-only abstractions.
  Date/Author: 2026-08-21 / Codex on behalf of Jun.

## Outcomes & Retrospective

Work is in progress. The existing PR has already reduced shared Motion cost and isolated three calendar/editor seams, but the remaining Workbench matrices, 17 actionable P1/P2 files, two exceptional single tests, and six P3 evidence reviews remain to be completed.

## Context and Orientation

The renderer test runner is configured by `vitest.renderer.config.ts` and runs ordinary TSX tests in jsdom with four fork workers. Pure renderer helpers use `vitest.node.config.ts` and filenames ending in `.node.test.ts` or `.node.test.tsx`. The shared Workbench test fixture is `src/renderer/components/workbench/workbench-testkit/workbench-shell-harness.tsx`; it mounts the real `WorkbenchShell` behind mocked transport and feature adapters. A seam is the place where callers cross a Module Interface. An adapter is a production or test implementation at that seam. A deep Module hides many state transitions behind a small Interface so callers and tests do not reconstruct those transitions through the UI.

The audit identified 35 files whose test execution was at least two seconds and two additional individual tests over one second. The audit's timings came from PR #71. PR #72 already changed the default Workbench fixture to reduced motion and created typed calendar adapters, so the first action in this plan is a new current-tree baseline rather than reusing stale numbers.

The architecture constraint is that the renderer Window Session aggregate owns live owner-scoped Scenes, panel trees, navigation, and geometry. Pure transitions for those concepts belong under `src/renderer/lib` or the narrow owning feature, while React components remain presentation and effect adapters. Conversation projection and draft logic belongs under `src/renderer/features/local-conversation`; component tests should not create a second ownership model.

## Plan of Work

Milestone one creates a reproducible timing ledger. Run all 37 audited files three times with the renderer configuration, capture Vitest's per-file `tests` durations, and inspect the slowest individual cases. For each row, identify the existing owning Module and Node coverage before creating anything new. This avoids duplicate state models and establishes which costs remain after the first PR changes.

Milestone two completes the Workbench remediation. Replace Shell-level matrices with tests through the existing Scene, panel-layout, command-admission, automation-draft, route-resolution, sidebar-projection, and Project Agent Dock Interfaces. Keep representative Shell paths for each distinct runtime effect or owner boundary. The nine Workbench files must collectively reach a three-sample median aggregate of at most 100 seconds on the local standard configuration, with every removed Shell assertion mapped to an existing or new Module test.

Milestone three completes the remaining actionable UI and conversation items. Extract only reusable product logic: diff-source resolution, effective thread settings, summary projection, picker ordering, draft payloads, resume eligibility, serializers, normalization, and visibility decisions. Do not create test-only pass-through helpers. Replace uncontrolled transitions and timers with injected state or Vitest fake time. Keep the minimum DOM cases that prove focus, selection, portal, mutation error recovery, and runtime lifecycle.

Milestone four validates the P3 keep decisions. Re-run each efficient suite, inspect its slowest case, and change it only if it contains an uncontrolled real wait or repeated heavy subtree unrelated to its contract. Otherwise record that the current boundary is correct and preserve it. This is an explicit remediation outcome, not an unreviewed omission.

Milestone five performs final validation and publishes evidence. Update `docs/FRONTEND.md` only for reusable cross-feature conventions and update the local audit ledger row by row. Run relevant Node and renderer tests while editing, then one stable typecheck and lint pass, three complete 37-item timing samples, the full renderer suite, normal PR CI, and an explicit full matrix. Re-check `origin/main`, rebase if needed, and resolve every review thread.

## Concrete Steps

All commands run from `/Users/asc/repo/nodex`.

The current-tree baseline uses:

    pnpm exec vitest run --config vitest.renderer.config.ts <all 37 audited test paths>

Pure Module tests use:

    pnpm exec vitest run --config vitest.node.config.ts <changed .node.test.ts paths>

Renderer integration tests use:

    pnpm exec vitest run --config vitest.renderer.config.ts <changed .test.tsx paths>

Final source checks use:

    pnpm run typecheck
    pnpm run lint

The full renderer proof uses:

    pnpm exec vitest run --config vitest.renderer.config.ts

GitHub proof uses the ordinary PR checks plus an explicit `CI` workflow dispatch with `full=true`. Record run and job links in the audit report and PR description.

## Validation and Acceptance

All original product contracts must have an explicit test mapping. No test may be deleted solely to improve timing. New pure tests must assert meaningful state transitions or payload contracts, not source strings or class names. Renderer tests must produce no `act(...)` or Suspense warnings.

The nine Workbench files must have a three-sample median aggregate `tests` duration no greater than 100 seconds. Each P0 date/property file must remain below 1.5 seconds in the same targeted measurement unless evidence shows runner-wide saturation. For other P1/P2 items, acceptance is structural and measured: rule matrices cross an owning pure Interface, uncontrolled real-time waits are eliminated, and DOM coverage is limited to behavior that requires DOM or React effects. P3 files pass unchanged or with narrowly justified fixes and have a recorded coverage-efficiency rationale.

The final full renderer run, typecheck, lint, PR-required checks, and explicit full GitHub matrix must pass. The PR must have zero unresolved review threads and remain based on the latest `origin/main`.

## Idempotence and Recovery

Timing commands and tests are read-only and safe to repeat. Make scoped conventional commits after each milestone so a failed experiment can be reverted without losing successful work. Do not use destructive Git commands. If `origin/main` advances, use the repository's elegant rebase workflow and re-run affected checks. If a proposed seam duplicates an existing Module, update the plan and use the existing Interface instead of layering a second abstraction.

## Artifacts and Notes

The detailed row-by-row ledger lives in `notes.local/2026-08-21-renderer-ci-slow-test-value-audit.zh-CN.md`; `notes.local` is intentionally local and is not committed. This checked-in ExecPlan records the implementation and acceptance method so another contributor can resume without the conversation.

The starting PR is https://github.com/junyudev/nodex/pull/72 at commit `7e9d28611bdabfd5b3441a6c849d99a7fe442603`.

## Interfaces and Dependencies

No new third-party dependency is expected. Vitest 4.1.10 supplies Node/jsdom environments, fake timers, mocks, and per-file selection. Testing Library remains the interaction adapter for React DOM. New product logic belongs in a small existing or new Interface under `src/renderer/lib` or the owning feature directory; a new adapter seam is permitted only when production and test adapters both represent real variation. Test-only adapters may replace heavyweight child Modules at an already real React composition seam, but must be typed from the production child props and paired with focused tests of the real child.

Plan revision note, 2026-08-21: created the plan after the user clarified that every audited item must receive a complete disposition rather than only the first high-return optimization layer.
