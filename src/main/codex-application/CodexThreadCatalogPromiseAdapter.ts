import type {
  CodexSidebarSnapshot,
  CodexThreadSummary,
  CodexThreadSummaryWindow,
  CodexThreadSummaryWindowInput,
  CommandPaletteThreadListInput,
  CommandPaletteThreadSummary,
} from "../../shared/types";
import type {
  CodexSidebarThreadMoveInput,
  CodexSidebarThreadMoveResult,
} from "../../shared/codex-sidebar-thread-move";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import { CodexThreadCatalogError, type CodexThreadCatalog } from "./CodexThreadCatalog";

export interface CodexThreadCatalogPromiseAdapter {
  readonly listPinned: () => Promise<readonly string[]>;
  readonly listProject: (
    projectId: string,
    input?: CodexThreadSummaryWindowInput,
  ) => Promise<CodexThreadSummaryWindow>;
  readonly listPalette: (
    input: CommandPaletteThreadListInput,
  ) => Promise<readonly CommandPaletteThreadSummary[]>;
  readonly resolve: (threadId: string) => Promise<CodexThreadSummary | null>;
  readonly setPinned: (
    threadId: string,
    pinned: boolean,
    beforeThreadId?: string | null,
  ) => Promise<CodexSidebarSnapshot>;
  readonly reorderPinned: (orderedThreadIds: readonly string[]) => Promise<CodexSidebarSnapshot>;
  readonly move: (input: CodexSidebarThreadMoveInput) => Promise<CodexSidebarThreadMoveResult>;
}

const unwrapCatalogError = (error: unknown): never => {
  if (error instanceof CodexThreadCatalogError) throw error.cause;
  throw error;
};

/** Promise projection for transitional Codex consumers; it owns no state or lifecycle. */
export const makeCodexThreadCatalogPromiseAdapter = (
  catalog: CodexThreadCatalog["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexThreadCatalogPromiseAdapter => ({
  listPinned: () => callbacks.runPromise(catalog.listPinned).catch(unwrapCatalogError),
  listProject: (projectId, input) =>
    callbacks.runPromise(catalog.listProject(projectId, input)).catch(unwrapCatalogError),
  listPalette: (input) =>
    callbacks.runPromise(catalog.listPalette(input)).catch(unwrapCatalogError),
  resolve: (threadId) => callbacks.runPromise(catalog.resolve(threadId)).catch(unwrapCatalogError),
  setPinned: (threadId, pinned, beforeThreadId) =>
    callbacks
      .runPromise(catalog.setPinned(threadId, pinned, beforeThreadId))
      .catch(unwrapCatalogError),
  reorderPinned: (orderedThreadIds) =>
    callbacks.runPromise(catalog.reorderPinned(orderedThreadIds)).catch(unwrapCatalogError),
  move: (input) => callbacks.runPromise(catalog.move(input)).catch(unwrapCatalogError),
});
