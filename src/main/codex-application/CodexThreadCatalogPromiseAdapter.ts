import type { CodexSidebarSnapshot } from "../../shared/types";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import { CodexThreadCatalogError, type CodexThreadCatalog } from "./CodexThreadCatalog";

export interface CodexThreadCatalogPromiseAdapter {
  readonly listPinned: () => Promise<readonly string[]>;
  readonly setPinned: (
    threadId: string,
    pinned: boolean,
    beforeThreadId?: string | null,
  ) => Promise<CodexSidebarSnapshot>;
  readonly reorderPinned: (orderedThreadIds: readonly string[]) => Promise<CodexSidebarSnapshot>;
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
  setPinned: (threadId, pinned, beforeThreadId) =>
    callbacks
      .runPromise(catalog.setPinned(threadId, pinned, beforeThreadId))
      .catch(unwrapCatalogError),
  reorderPinned: (orderedThreadIds) =>
    callbacks.runPromise(catalog.reorderPinned(orderedThreadIds)).catch(unwrapCatalogError),
});
