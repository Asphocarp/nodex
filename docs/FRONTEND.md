# Frontend

## Stack
- React 19 + TypeScript (`strict`)
- Tailwind CSS + local UI primitives in `src/renderer/components/ui/`
- BlockNote editor for rich card descriptions
- Atlassian Pragmatic Drag and Drop for board drag-and-drop

## Structure
- App shell: `src/renderer/app.tsx`
- Domain components: `src/renderer/components/kanban/`
- Active local conversation renderer: `src/renderer/features/local-conversation/`
- Editor subsystem: `src/renderer/components/kanban/editor/`
- Shared hooks/helpers: `src/renderer/lib/`
- NFM conversion/parsing: `src/renderer/lib/nfm/`
- Storybook workspace: `packages/storybook/` with colocated `*.stories.tsx` under `src/renderer/`

## State and Data Access
- API boundary: always go through `src/renderer/lib/api.ts`.
- Board state: `useKanban` uses a shared `kanban-store` optimistic journal (`baseBoard + pending/local overlays`) with LWW conflict superseding, rollback-on-failure, and store-derived cross-view sync.
- Card updates use typed mutation control flow: `updated | conflict | not_found | error` instead of treating stale-write conflicts as generic exceptions.
- On `conflict`, keep optimistic journal semantics: supersede conflicting overlays, refresh base board, and let surface-specific UX decide recovery (`Card Stage` inline banner with `Reload Latest` / `Overwrite Mine`).
- History/undo: `use-history.ts`.
- Project lifecycle: `use-projects.ts`.
- SSE/IPC updates are centralized in API subscription helpers.
- Live workbench navigation/session state is window-local (`sessionStorage`), while shared preferences remain in `localStorage`.
- Restart resume is a separate Electron-only path: the main process stores one durable last-window snapshot under profile-scoped `userData`, and renderer bootstrap consumes it only when a window is created from zero open windows.
- Terminal: `use-terminal.ts` manages ghostty-web lifecycle, fit/resize behavior, and PTY IPC.
- Active conversation UI: reduce host messages and conversation snapshots in `features/local-conversation/`, then derive renderer-only projection data in `features/local-conversation/projection/*`. Keep transcript projection, composer-shell aggregation, search-unit derivation, turn-request stitching, and background-activity ordering upstream of JSX.
- Keep active conversation UI ownership inside `features/local-conversation/view/*` and `features/local-conversation/view/shared/*`. Do not reintroduce a second workbench thread renderer path outside that feature.
- Use `@tanstack/react-form` for structured renderer forms with real validation or value coercion; keep simple one-field inputs on local state and use `src/renderer/lib/forms.ts` for shared submit/error helpers.
- Keep runtime validation at boundaries:
  - shared storage / transport / raw JSON schemas live under `src/shared/schemas/*`
  - renderer-only persisted-state parsing lives in `src/renderer/lib/workbench-persisted-schemas.ts`
  - once data is normalized into local reducers/view models, keep the rest of the renderer plain TypeScript instead of re-parsing inside components

## Editor Patterns
- Keep custom editor behaviors in dedicated modules under `editor/`.
- Keep schema and extension composition centralized (`nfm-schema`, `toggle-list-schema`, extension helpers).
- Add behavior regression tests next to editor helpers (`*.test.ts`).
- Preserve NFM round-trip compatibility when changing parser/serializer/adapters.

## Styling Conventions
- Global styles in `src/renderer/globals.css`.
- Keep renderer CSS layered the same way Codex Electron does:
  - `src/renderer/styles/theme-source.css` owns author-maintained theme tokens, Tailwind theme declarations, and the CSS-side `--vscode-*` contract.
  - `src/renderer/styles/theme-codex-foundation.generated.css` owns the generated Codex Electron foundation layer for radius math, spacing, toolbar sizing, and window-scoped runtime overrides.
  - `src/renderer/styles/theme-codex-utilities.generated.css` owns the generated Codex Electron utility contract for exact shipped utility selectors and Codex-specific arbitrary/container utility coverage.
  - `src/renderer/styles/theme-codex-contract.generated.css` owns the generated canonical Codex Electron `--color-token-*` contract and `--vscode-*` window contract.
  - `src/renderer/styles/theme-token-bridge.css` owns only Tailwind-facing authored aliases that are not part of the generated Codex contract or the generated Codex foundation layer.
  - `src/renderer/styles/theme-codex-surface.generated.css` owns the generated Codex Electron component/global surface rules that are intentionally synced from the reference CSS.
  - `src/renderer/styles/theme-utilities.css` owns authored Nodex-local utilities that are intentionally outside the generated Codex utility contract.
  - `src/renderer/styles/theme-surface.css` owns authored surface rules and global renderer CSS.
  - `src/renderer/lib/codex-theme-variant.ts` owns the runtime semantic theme bridge that injects derived foreground/control/border/panel/editor variables onto `document.documentElement`.
  - Sync `src/renderer/styles/theme-codex-contract.generated.css` from the exact Codex Electron contract blocks only, not by scanning the whole reference CSS for matching prefixes.
  - Sync `src/renderer/styles/theme-codex-foundation.generated.css`, `src/renderer/styles/theme-codex-utilities.generated.css`, and `src/renderer/styles/theme-codex-surface.generated.css` from exact Codex Electron foundation/utility/component blocks instead of hand-copying declarations into source files.
  - Reuse semantic chip/badge patterns for priority/estimate/status.
  - Avoid duplicating visual rules across board and toggle-list surfaces.
- Follow Codex Electron's renderer composition order:
  - normalize raw runtime data into stable renderer-facing item/view schemas first
  - bucket/project semantic lanes before JSX
  - render those lanes through shared shells and shared token classes
  - only add local CSS when the visual contract cannot be expressed through existing tokens, utilities, or shared primitives
- Prefer existing token families over new component-local values:
  - use `text-token-*`, `bg-token-*`, `border-token-*`, `rounded-*`, `text-size-*`, `font-vscode-editor`, and window-width/padding vars before inventing new colors, spacing, or radii
  - keep theme/color ownership in the generated Codex contract/foundation layers plus the runtime theme bridge, not in feature components
- Keep app-owned SVG icons centralized:
  - prefer `lucide-react` for generic stock icons that already exist in the library
  - keep all custom SVGs in `src/renderer/components/shared/icons.tsx`
- Prefer shared primitives over bespoke wrappers:
  - if a surface looks like an existing row shell, accordion shell, summary header, fade-mask container, or compact card, reuse or extract a primitive instead of restyling a feature-local wrapper
  - keep visual density aligned to the existing rhythm (`gap-*`, `px-panel`, `var(--conversation-tool-assistant-gap)`) rather than per-component spacing tweaks
- Mirror Codex Electron's transcript animation split:
  - for Codex-native expandable transcript surfaces, reuse a shared measured-height hook and let each subtype own its own `motion.div` / `AnimatePresence` wrapper and state machine
  - keep transcript expand/collapse subtype-owned; reuse the measured-height hook, but let each Codex-parity surface own its own Motion wrapper and state machine
- Treat utilities as part of the design contract:
  - if a class exists as an exact shipped Codex selector, keep it in the generated utility layer
  - if a class is renderer-local and not recoverable from the shipped Codex CSS, keep it in `theme-utilities.css`
  - do not re-create shipped utility selectors by hand in local feature CSS
- Keep selector dropdown content on the shared tokenized menu chrome in `src/renderer/components/ui/selector-menu-chrome.ts`; let trigger styling stay local to each surface.
- Theme `@pierre/diffs` instances through host `style` plus `options.unsafeCSS`; use the shared renderer helper in `src/renderer/lib/diff-presentation.ts` instead of per-surface shadow-DOM CSS or broad global selectors.
  - Keep the Codex-style utility contract in the generated Codex utility layer so exact shipped selectors remain available even when Tailwind would not regenerate them from the local source graph alone.
  - Reserve `theme-utilities.css` for Nodex-local additions, not for reconstructed copies of Codex Electron utility families.
- Treat `--tw-*` property registrations as build-output contract: values such as `--tw-leading` or `--tw-contain-layout` come from Tailwind's compiled property layer, not from manual theme-token declarations.
- For Threads, keep the scroll body and composer separate: unresolved live request cards belong to the composer shell, not the scroll body. The composer shell also owns queued follow-ups, pending steers, background terminal rows, and background child-agent rows; the scroll body only renders turn blocks plus hidden turn-scoped request semantics (`approval`, `userInput`, `implementPlan`) injected into the item stream before bucketization.
- Keep thread-footer width ownership outside the composer shell:
  - the footer/screen wrapper owns `max-w-[var(--thread-composer-max-width)]` and `px-panel`
  - the fixed above-composer block host (`above-composer-portal`) and the queue/background lane host (`above-composer-queue-portal`) both stay in that footer wrapper as siblings directly above `LocalConversationComposerShell`; do not move either host into the scroll body or a separate overlay layer
  - `LocalConversationComposerShell` should stay a pure stack/layout switcher
  - `ThreadComposer` should render the composer form itself, not re-wrap the whole footer width a second time
- Keep the queue/pending-steer lane on the Codex Electron row family:
  - project raw queued follow-ups and pending steers into dedicated row models before JSX
  - render pending steers and queued follow-ups in one shared above-composer lane panel instead of separate cards or footer widgets
  - keep queued follow-up reorder on the same sortable/dnd row contract as Codex Electron rather than native HTML drag/drop
  - keep row copy/tooltips/actions source-derived and lane-owned instead of rebuilding those strings or affordances inside generic shell wrappers
- Keep composer request cards in the Codex Electron family shape:
  - dispatch by request type through one shell-owned renderer (`approval`, `userInput`, `implementPlan`, `mcpServerElicitation`)
  - use one shared questionnaire shell for approval, user-input, and implement-plan cards instead of nesting a second local card inside those request surfaces
  - approval cards own their body preview (`command`, `network`, or `patch`) and pass that preview into the shared questionnaire shell
  - background-child approvals do not get a separate worker-name header; inject that child identity inline into the approval prompt only when the Codex approval prompt branch calls for it
  - request-card stories should exercise the dedicated Codex request-card components directly, not older wrapper aliases
- Keep renderer forms boundary-led: use TanStack Form with a colocated zod schema module when a form has structural validation, type coercion, or multi-field constraints. For simple single-field inputs, keep local state and a submit-time guard instead of introducing a separate schema module.
- For thread search, project stable user/assistant search units in the view model and attach them to rendered blocks; do not implement `Find in thread` by scraping arbitrary DOM text from the whole turn.

## Component SOP
- Start from existing semantics, not from JSX. New UI behavior should usually begin in a projector, bucketizer, normalizer, or other renderer-facing adapter before touching leaf components.
- Keep leaf renderers dumb. Message/tool/request components should consume already-derived props such as lane membership, action eligibility, placeholder state, or copy text instead of recomputing those rules locally.
- Keep one canonical lane per semantic role. Final assistant content, leading user prefix actions, exploration groups, pending-request lanes, and diff lanes should each be derived once and rendered once.
- Keep transcript-special rows dedicated. Items such as context compaction, automatic approval review, and multi-agent activity should render through their own Codex-style leaf components instead of falling back to generic system banners.
- Prefer shipped behavior over source-looking class strings. If bundle behavior and an apparent source token disagree, treat the shipped CSS/renderer output as authoritative.
- Keep component chrome subdued. Secondary actions should stay small, low-emphasis, and hover-revealed unless the upstream Codex surface makes them primary.

## Frontend Testing
- Run targeted tests while iterating: `bun test src/renderer/...`
- Run isolated UI harness: `bun run dev:storybook`
- Build the isolated UI harness before handoff when story code changes: `bun run build:storybook`
- Treat Storybook as part of the UI contract. When adding or changing any user-visible UI, update or add the focused stories in the same change instead of leaving Storybook behind.
- Keep Storybook scenes canvas-first: use story variants, `args`, and `argTypes` for presets and controls instead of rendering custom preset/control sidebars inside story pages.
- Keep Storybook scenes production-backed: thread and card-stage stories should build state from the same projection/helpers used by shipped UI instead of hand-authoring parallel fake view models.
- Current thread stories live under `src/renderer/features/local-conversation/view/` for composed stage scenarios and under `src/renderer/features/local-conversation/view/shared/` for focused transcript-special, tool, and request leaf stories. Keep Codex transcript-special surfaces such as reasoning, todo lists, automatic approval review, and multi-agent activity in the transcript-special stories instead of forcing them into tool-call stories.
- Keep tool-call stories scoped to actual Codex tool families. Transcript-special surfaces that happen to originate from tool-like raw items still belong in transcript-special stories once the projector gives them their own semantic lane.
- Default renderer component tests to DOM-based coverage with Bun + `happy-dom` + `@testing-library/react`.
- Assert user-visible structure, labels, and behavior through rendered DOM queries; keep `data-testid` and raw class checks as fallback tools, not the default.
- Reserve HTML-string or server-render assertions for cases where serialized markup is the actual contract.
- Do not add source-string tests that only verify implementation text inside a file.
- Prioritize parser/editor and hook tests for regression safety.
