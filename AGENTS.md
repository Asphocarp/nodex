# AGENTS.md

> **IMPORTANT for agents:** Always commit changes after all edits are done (with a prefix like `feat:`/`fix:`/`docs:`/`refactor:`/`chore:`, e.g. `feat: add kanban board`). Do not leave uncommitted changes at the end of a task.

## Global Instructions
- This app has no real users or real data yet. Feel free to make whatever huge changes/refactors you want and do not worry about it.
- For frontend design, prioritize an elegant, information-dense layout with minimal logical/visual redundancy and shallow nesting.
- Do not read repository contents via web crawling from `raw.githubusercontent.com` because it is not stable for agent workflows. For remote repository inspection, clone the repository into a temporary local directory and read files from the local clone instead.
- When writing bun unit tests, be aware that `expect` is of type `expect(value: unknown): { toBe: (expected: unknown) => void; toBeTrue: () => void; toBeFalse: () => void; not: { toBeNull: () => void; }; }` 
  - there is ONLY `toBe`, `toBeTrue`, `toBeFalse`, `not.toBeNull`.
  - there is NO `toBeUndefined`, `toEqual`, `toBeNull` or `toContain`.
- DO NOT write tests that only assert a source file contains a string (source-string tests); that is redundant with the implementation and does not validate behavior. Prefer checking generated CSS/build output or a real rendered/runtime outcome.
- Read [official doc of codex-app-server](https://developers.openai.com/codex/app-server.md) when dealing with codex-app-server.


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
- Keep data validation at boundaries (`src/main/http-server.ts`, `src/main/kanban/card-input-validation.ts`).
- Prefer pure helpers in `src/renderer/lib/` for reusable behavior.
- Keep renderer transport-agnostic by going through `src/renderer/lib/api.ts`.
- Preserve project scoping for stateful UI and server operations.

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

Treat `CHANGELOG.md` as a required deliverable for any user-visible change:
- Keep an `Unreleased` section at the top.
- Write for humans, not commit-log style.
- Only include externally relevant changes:
  - Added
  - Changed
  - Deprecated
  - Removed
  - Fixed
  - Security
- Do NOT add entries for pure refactors, formatting, comments, test-only changes, or internal tooling changes unless they affect users.
- Do NOT add entries to Changed/Fixed if you are changing/fixing a feature that is Unreleased.
- Use one bullet per user-visible change.
- Prefer impact-oriented wording, not implementation wording.

## Testing Expectations
- Prefer targeted tests while iterating: `bun test <path-to-test>`
- For any new or changed user-visible UI, update or add Storybook coverage in the same change.
- Run full checks before handoff:
  - `bun run typecheck`
  - `bun run lint`
  - `bun test`

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
