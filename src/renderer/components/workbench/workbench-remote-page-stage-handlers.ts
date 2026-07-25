import { invoke } from "@/lib/api";
import type { PageInput, PageUpdateMutationResult } from "@/lib/types";
import type { PageStageHandlers } from "@/lib/use-page-stage";
import { createUuidV7 } from "../../../shared/uuid-v7";
import { isWorkflowStatus } from "../../../shared/workflow-status";
import { commitPageLifecycleIntent } from "@/lib/page-lifecycle-runtime";
import {
  commitDatabasePageDrag,
  databaseViewRenderModelToDragSnapshot,
} from "@/lib/database-page-drag-runtime";
import { getKanbanProjectStore } from "@/lib/kanban-store";
import {
  isPageMetadataPatch,
} from "@/lib/page-detail-metadata-runtime";
import { commitPageMetadataPatchForBoard } from "@/lib/page-metadata-board-runtime";
import {
  PAGE_DOCUMENT_MUTATION_REQUIRED_MESSAGE,
  findPageDocumentPatchFields,
} from "../../../shared/page-content-authority";

export function makeRemotePageStageHandlers(projectId: string): PageStageHandlers {
  return {
    onPatch: () => {
      // no-op for remote-opened sessions
    },
    onUpdate: async (columnId: string, pageId: string, updates: Partial<PageInput>) => {
      void columnId;
      if (findPageDocumentPatchFields(updates).length > 0) {
        return {
          status: "error",
          error: PAGE_DOCUMENT_MUTATION_REQUIRED_MESSAGE,
        } satisfies PageUpdateMutationResult;
      }
      if (!isPageMetadataPatch(updates)) {
        return {
          status: "error",
          error: "No mutable Page metadata was specified",
        } satisfies PageUpdateMutationResult;
      }
      return await commitPageMetadataPatchForBoard({
        projectId,
        pageId: pageId,
        operationId: crypto.randomUUID(),
        patch: updates,
      });
    },
    onDelete: async (columnId: string, pageId: string) => {
      void columnId;
      await commitPageLifecycleIntent({
        kind: "delete",
        projectId,
        operationId: crypto.randomUUID(),
        pageId: pageId,
      });
    },
    onMove: async (fromStatus: string, pageId: string, toStatus: string) => {
      if (!isWorkflowStatus(fromStatus) || !isWorkflowStatus(toStatus)) {
        throw new Error("Page Stage move requires canonical Page statuses");
      }
      const databaseView = getKanbanProjectStore(
        projectId,
        null,
      ).getSnapshot().databaseView;
      if (!databaseView) {
        throw new Error("The Database View must be loaded before moving a Page");
      }
      await commitDatabasePageDrag({
        projectId,
        operationId: crypto.randomUUID(),
        move: { pageId: pageId, fromStatus, toStatus },
        snapshot: databaseViewRenderModelToDragSnapshot(databaseView),
      });
    },
    onCompleteOccurrence: async (pageId: string, occurrenceStart: Date) => {
      await invoke("page:occurrence:complete", projectId, {
        operationId: crypto.randomUUID(),
        createdPageId: createUuidV7(),
        pageId: pageId,
        occurrenceStart,
        source: "page-detail",
      });
    },
    onSkipOccurrence: async (pageId: string, occurrenceStart: Date) => {
      await invoke("page:occurrence:skip", projectId, {
        operationId: crypto.randomUUID(),
        pageId: pageId,
        occurrenceStart,
        source: "page-detail",
      });
    },
  };
}
