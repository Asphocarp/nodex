# AGENTS.md

## **IMPORTANT Global Instructions for Agents:**
- Always commit changes after all edits are done (with a prefix like `feat:`/`fix:`/`docs:`/`refactor:`/`chore:`, e.g. `feat: add kanban board`). Do not leave uncommitted changes at the end of a task.
- This app has no real users or real data yet. Prefer long-term architectural correctness over short-term compatibility. Breaking changes, schema migrations, and large refactors are acceptable when they make the product model simpler and more coherent.
- For frontend design, prioritize an elegant, information-dense layout with minimal logical/visual redundancy and shallow nesting.
- Keep implementation notes, docs, changelog entries, commit messages, and handoff summaries product-native: describe what Nodex does and why, without surfacing private provenance, comparative targets, or reconstruction details unless the user explicitly asks for research notes.
- Do not read repository contents via web crawling from `raw.githubusercontent.com` because it is not stable for agent workflows. For remote repository inspection, clone the repository into a temporary local directory and read files from the local clone instead.
- When writing bun unit tests, be aware that `expect` is of type `expect(value: unknown): { toBe: (expected: unknown) => void; toBeTrue: () => void; toBeFalse: () => void; not: { toBeNull: () => void; }; }` 
  - there is ONLY `toBe`, `toBeTrue`, `toBeFalse`, `not.toBeNull`.
  - there is NO `toBeUndefined`, `toEqual`, `toBeNull` or `toContain`.
- DO NOT write tests that only assert a source file contains a string (source-string tests); that is redundant with the implementation and does not validate behavior. Prefer checking generated CSS/build output or a real rendered/runtime outcome.
- Read [official doc of codex-app-server](https://developers.openai.com/codex/app-server.md) when dealing with codex-app-server.
- After UI modification, no need to verify the UI changes yourself using playwright or anything. Just tell user to do it, which is more efficient.


## Project Overview
Nodex is a local-first, block-based agent orchestrator.
It ships as an Electron desktop app plus a CLI/HTTP API backed by SQLite.

## Setup Commands
- Install deps: `bun install`
- Dev app: `bun run dev`
- Build: `bun run build`
- Package installers: `bun run package`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Unit tests: `bun test`

## Runtime and Tooling
- Package manager: Bun
- Language: TypeScript (`strict` mode)
- Desktop shell: Electron + electron-vite
- Frontend: React 19 + Tailwind + Radix + BlockNote/Prosemirror
- Backend in main process: Hono + better-sqlite3

## Code Style
- **DRY**: Always keep code DRY. Extract shared hooks, helpers, and patterns instead of duplicating.
- **Tailwind over custom CSS**: Use Tailwind utility classes. Avoid inflating `globals.css` with new custom class rules.
- Before defining any new protocol-facing type, first check `packages/codex-app-server-protocol/src/v2`.
- Treat `packages/codex-app-server-protocol/src/v2` as the source of truth for Codex app server request/response/notification/thread shapes.
- Prefer importing protocol types directly, or re-exporting them as aliases when a local name is needed.
- Do not hand-write parallel protocol field definitions in `src/shared/types.ts` unless the local type is intentionally a derived or view-model shape.
- Keep data validation at boundaries (`src/main/http-server.ts`, `src/main/local-store/card-input-validation.ts`).
- Prefer pure helpers in `src/renderer/lib/` for reusable behavior.
- Keep renderer transport-agnostic by going through `src/renderer/lib/api.ts`.
- Preserve project scoping for stateful UI and server operations.

## Architectural Preference
- Default to the long-term, architecturally clean solution over the smallest incremental patch, even when that requires broad refactors, internal API changes, schema migrations, or breaking changes inside this repository.
- This project has no real users or real data yet. Do not preserve legacy behavior, compatibility layers, duplicate paths, or awkward abstractions merely to reduce diff size.
- When choosing between a quick local fix and a deeper model-level fix, prefer the model-level fix if it simplifies ownership, removes special cases, or makes future features easier to build.
- Large refactors are acceptable, but they must still be coherent: preserve project scoping, update the source-of-truth docs, migrate affected call sites, remove obsolete code paths, and run the relevant checks.
- Do not overbuild speculative abstractions. A long-term solution should reduce conceptual complexity, not add indirection for its own sake.
- If a long-term fix is too large for one safe change, implement a clean vertical slice and document the remaining migration path instead of landing a temporary workaround.

## Architecture
Read `ARCHITECTURE.md` first for system boundaries and dependency flow.

## Documentation Map
Use these docs as the source of truth:
- System codemap and invariants: `ARCHITECTURE.md`
- Execution-plan format and requirements: `docs/PLANS.md`
- Frontend conventions and editor patterns: `docs/FRONTEND.md`
- UI design guidance for agent-built surfaces: `.agents/skills/general-design-guidelines/SKILL.md`
- Product principles and tradeoffs: `docs/PRODUCT_SENSE.md`
- Reliability model (backups, SSE/IPC sync, ops): `docs/RELIABILITY.md`
- Security model and hardening checklist: `docs/SECURITY.md`
- Keyboard shortcuts reference: `docs/KEYBOARD_SHORTCUTS.md`
- Current quality grading and gaps: `docs/QUALITY_SCORE.md`
- Implementation learnings and regression caveats: `docs/ENGINEERING_LEARNINGS.md`
- Product behavior specifications: `docs/product-specs/`
- External/reference specs (NFM format, examples): `docs/references/`

## Documentation Update Rules
Documentation maintenance is an active, required responsibility for every agent task.

When behavior changes, update the narrowest source-of-truth doc:
- User-visible behavior/API contract changes: `docs/product-specs/nodex-product-spec.md`
- Architecture boundary changes: `ARCHITECTURE.md`
- New reusable UI design guidance for agents: `.agents/skills/general-design-guidelines/SKILL.md`
- New implementation caveat/regression learning: `docs/ENGINEERING_LEARNINGS.md`
- New reliability/security expectation: `docs/RELIABILITY.md` or `docs/SECURITY.md`

Treat `CHANGELOG.md` as a required deliverable only for **release-note-worthy** user-visible changes:
- Keep an `Unreleased` section at the top.
- Write for humans, not commit-log style.
- Only include externally relevant changes:
  - Added
  - Changed
  - Deprecated
  - Removed
  - Fixed
  - Security
- Do NOT add changelog entries for tiny UI fixups, visual parity tweaks, styling/token/color adjustments, copy nits, or small interaction polish, even when user-visible.
- Do NOT add entries for pure refactors, formatting, comments, test-only changes, or internal tooling changes unless they affect users.
- Do NOT add entries to Changed/Fixed if you are changing/fixing a feature that is Unreleased.
- If unsure whether a change belongs in release notes, default to leaving `CHANGELOG.md` unchanged and mention that choice in the final response.
- Use one bullet per user-visible change.
- Prefer impact-oriented wording, not implementation wording.

## Testing Expectations
- Use a two-tier validation strategy: run targeted checks while iterating, then run required handoff checks once after the final edit set is stable.
- Prefer targeted tests while iterating: `bun test <path-to-test>`
- Match checks to the changed surface while iterating:
  - Pure helpers/domain logic: run the related unit test file.
  - Renderer workflow changes: run the related renderer test(s) plus `bun run typecheck` when types or props changed.
  - Main process/store/protocol/migration changes: run the nearest relevant unit or integration test before the full handoff checks.
  - Styling or copy-only UI changes: run `bun run lint` and `bun run typecheck` when TypeScript/TSX files changed; rely on Storybook/docs/manual review for visual parity.
- For docs-only changes, skip code checks unless the docs change generated artifacts or executable examples. Validate the markdown diff directly and state that no code checks were needed.
- Prefer tests that prove behavior or domain contracts over tests that mirror implementation details. Avoid trivial UI assertions such as long `className`/Tailwind string matching, broad `textContent.includes(...)`, or "X contains Y string" checks unless the string is a real user-visible or accessibility contract.
- For UI parity work, put numeric/state rules in pure helpers with boundary tests, keep renderer integration tests to a small number of critical user workflows, and use Storybook/docs/manual review for visual details like shadows, radii, z-index tokens, and motion styling.
- Renderer React tests must be act-clean. Treat any `act(...)` warning as a failing test: fix the test before handoff instead of ignoring console output.
- For renderer interactions that can schedule React updates, prefer Testing Library async patterns (`findBy*`, `waitFor`, awaited helpers) and make assertions only after the UI has settled.
- When a renderer test uses low-level `fireEvent`, window/document events, timers, resize/drag gestures, or imperative callbacks instead of a higher-level awaited helper, wrap the interaction in `await act(async () => { ...; await Promise.resolve(); })`, then wait for the observable DOM/API outcome. Use `try/finally` to release drag/resize gestures so failed assertions do not leak body styles or global listeners into later tests.
- For any new or changed user-visible UI, update or add Storybook coverage in the same change.
- Run full checks before handoff for code changes, preferably in parallel because these commands are independent:
  - `bun run typecheck`
  - `bun run lint`
  - `bun test`
- If one full check fails, fix the issue and rerun the failed check plus any related targeted checks. Rerun all three full checks only when the fix could affect more than the failed surface.

## Commit and PR Expectations
- Keep changes scoped and atomic.
- Update related docs in the same change when contracts or workflows change.
- Include commands run and validation outcomes in your PR notes.

## Frontend tasks

When doing frontend design tasks, avoid generic, overbuilt layouts.

**Use these hard rules:**
- Prioritize an elegant, information-dense layout with minimal logical/visual redundancy and shallow nesting.
- One composition: The first viewport must read as one composition, not a dashboard (unless it's a dashboard).
- Brand first: On branded pages, the brand or product name must be a hero-level signal, not just nav text or an eyebrow. No headline should overpower the brand.
- Brand test: If the first viewport could belong to another brand after removing the nav, the branding is too weak.
- Typography: Use expressive, purposeful fonts and avoid default stacks (Inter, Roboto, Arial, system).
- Background: Don't rely on flat, single-color backgrounds; use gradients, images, or subtle patterns to build atmosphere.
- Full-bleed hero only: On landing pages and promotional surfaces, the hero image should be a dominant edge-to-edge visual plane or background by default. Do not use inset hero images, side-panel hero images, rounded media cards, tiled collages, or floating image blocks unless the existing design system clearly requires it.
- Hero budget: The first viewport should usually contain only the brand, one headline, one short supporting sentence, one CTA group, and one dominant image. Do not place stats, schedules, event listings, address blocks, promos, "this week" callouts, metadata rows, or secondary marketing content in the first viewport.
- No hero overlays: Do not place detached labels, floating badges, promo stickers, info chips, or callout boxes on top of hero media.
- Cards: Default: no cards. Never use cards in the hero. Cards are allowed only when they are the container for a user interaction. If removing a border, shadow, background, or radius does not hurt interaction or understanding, it should NOT be a card.
- One job per section: Each section should have one purpose, one headline, and usually one short supporting sentence.
- Real visual anchor: Imagery should show the product, place, atmosphere, or context. Decorative gradients and abstract backgrounds do not count as the main visual idea.
- Reduce clutter: Avoid pill clusters, stat strips, icon rows, boxed promos, schedule snippets, and multiple competing text blocks.
- Use motion to create presence and hierarchy, not noise. Ship at least 2-3 intentional motions for visually led work.
- Color & Look: Choose a clear visual direction; define CSS variables; avoid purple-on-white defaults. No purple bias or dark mode bias.
- Ensure the page loads properly on both desktop and mobile.
- For React code, prefer modern patterns including useEffectEvent, startTransition, and useDeferredValue when appropriate if used by the team. Do not add useMemo/useCallback by default unless already used; follow the repo's React Compiler guidance.
