import { createUuidV7 } from "../../shared/uuid-v7";
import { isWorkflowStatus } from "../../shared/workflow-status";
import {
  buildCreateCardTransform,
  conflictKeysForCreate,
  createOptimisticCard,
} from "./kanban-optimistic-ops";
import { getKanbanProjectStore } from "./kanban-store";
import { setDatabaseRowDetail } from "./database-row-detail-store";
import { commitPageLifecycleIntent } from "./page-lifecycle-runtime";
import {
  gatePageCreateInputByCapabilities,
  resolvePageCreatePropertyCapabilities,
} from "./page-create-capabilities";
import type {
  DatabasePage,
  PageCreateInput,
  PageCreateMutationResult,
  PageCreatePlacement,
  WorkflowStatus,
} from "./types";

export interface CreateKanbanPageCommandInput {
  readonly projectId: string;
  readonly databaseViewId?: string | null;
  readonly clientSessionId?: string;
  readonly status: WorkflowStatus;
  readonly input: PageCreateInput;
  readonly placement?: PageCreatePlacement;
}

function ensureCreateInputId(input: PageCreateInput): PageCreateInput {
  if (input.id?.trim()) return input;
  return {
    ...input,
    id: createUuidV7(),
  };
}

async function requireWritableSelectedView(
  store: ReturnType<typeof getKanbanProjectStore>,
  databaseViewId: string | null | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!databaseViewId) return { ok: true };

  if (!store.getSnapshot().databaseView) {
    await store.fetchBoard();
  }

  const databaseView = store.getSnapshot().databaseView;
  if (databaseView?.primaryWriteCompatible) return { ok: true };

  const error = databaseView?.readOnlyReason
    ?? "The selected Database View is not ready for writes";
  store.setError(error);
  return { ok: false, error };
}

/**
 * The renderer command shared by every Page-creation entry point. It keeps the
 * optimistic projection and Core lifecycle boundaries independent of any
 * mounted Board component.
 */
export async function createKanbanPage({
  projectId,
  databaseViewId,
  clientSessionId,
  status,
  input,
  placement = "bottom",
}: CreateKanbanPageCommandInput): Promise<PageCreateMutationResult> {
  const store = getKanbanProjectStore(projectId, databaseViewId ?? null);
  const writable = await requireWritableSelectedView(store, databaseViewId);
  if (!writable.ok) {
    return { status: "error", error: writable.error };
  }
  if (!isWorkflowStatus(status)) {
    return {
      status: "error",
      error: "Page creation requires a canonical Page status",
    };
  }

  const currentView = databaseViewId ? store.getSnapshot().databaseView : null;
  const capabilityGatedInput = currentView
    ? gatePageCreateInputByCapabilities(
        input,
        resolvePageCreatePropertyCapabilities(currentView.query.properties),
      )
    : input;
  const createInput = ensureCreateInputId(capabilityGatedInput);
  const optimisticPage = createOptimisticCard(createInput);
  const operationId = crypto.randomUUID();
  const outcome = await store.runOptimisticMutation<DatabasePage>({
    kind: "page:create",
    conflictKeys: conflictKeysForCreate(status, optimisticPage.id),
    apply: buildCreateCardTransform(status, optimisticPage, placement),
    runRemote: async () => {
      const committed = await commitPageLifecycleIntent({
        kind: "create",
        projectId,
        operationId,
        clientSessionId,
        pageId: optimisticPage.id,
        status,
        input: createInput,
        placement,
      });
      if (!committed.boardProjection) {
        throw new Error("Created Page is missing from canonical authority");
      }
      return committed.boardProjection;
    },
  });

  if (!outcome.ok) {
    return {
      status: "error",
      error: outcome.error?.message ?? "Failed to create Page",
    };
  }
  if (!outcome.result) {
    return { status: "error", error: "Missing Page create result" };
  }

  setDatabaseRowDetail(projectId, outcome.result);
  store.applyRemoteCard(outcome.result);
  return { status: "created", page: outcome.result };
}
