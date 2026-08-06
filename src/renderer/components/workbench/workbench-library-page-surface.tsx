import { useEffect, useMemo } from "react";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";

import { PageStage } from "./workbench-page-stage";
import { readLibraryPageDetail } from "../../lib/api";
import { projectPageDetailToStageModel } from "../../lib/page-stage-page";
import {
  commitLibraryPageDetailMetadataPatch,
  commitLibraryPageDetailPropertyEdit,
} from "../../lib/page-detail-metadata-runtime";
import type { DatabaseId } from "../../../shared/database-identities";
import { queryKeys } from "../../lib/query-keys";
import { invalidateExactQuery } from "../../lib/query-invalidation";
import { useProjectionInvalidationRegistry } from "../../lib/projection-invalidation-context";
import { libraryContentAccess } from "../../../shared/content-access-context";
import { pageDetailDataDependencies } from "../../lib/page-detail-projection-dependencies";

export function WorkbenchLibraryPageSurface({
  pageId,
  surfaceId = pageId,
  isActivePanelTab = true,
  onClose = () => undefined,
  onOpenDatabase,
  onOpenPage,
  onOpenCanvas,
  onTitleChange,
}: {
  readonly pageId: string;
  readonly surfaceId?: string;
  readonly isActivePanelTab?: boolean;
  readonly onClose?: () => void;
  readonly onOpenDatabase: (databaseId: DatabaseId) => void;
  readonly onOpenPage?: (
    pageId: string,
    titleSnapshot?: string,
  ) => void;
  readonly onOpenCanvas?: (
    canvasBlockId: string,
    titleSnapshot?: string,
  ) => void;
  readonly onTitleChange?: (title: string) => void;
}) {
  const queryClient = useQueryClient();
  const projectionRegistry = useProjectionInvalidationRegistry();
  const detailQueryKey = useMemo(
    () => queryKeys.library.pageDetail(pageId),
    [pageId],
  );
  const detail = useQuery({
    queryKey: detailQueryKey,
    queryFn: async () => {
      const result = await readLibraryPageDetail(pageId);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });
  const stagePage = useMemo(() => {
    if (!detail.data) return null;
    return projectPageDetailToStageModel(detail.data);
  }, [detail.data]);

  useEffect(() => {
    const title = stagePage?.page.title.trim();
    if (!title) return;
    onTitleChange?.(title);
  }, [onTitleChange, stagePage?.page.title]);
  useEffect(() => {
    const authority = detail.data;
    if (!authority) return;
    const getCursor = () => {
      const currentDetail = queryClient.getQueryData<typeof authority>(detailQueryKey);
      if (!currentDetail) return null;
      return {
        storeEpoch: currentDetail.storeEpoch,
        changeLogSeq: currentDetail.changeLogSeq,
      };
    };
    const unregisterDetail = projectionRegistry.register({
      scope: { kind: "library", libraryId: authority.libraryId },
      consumerKey: hashKey(["projection", detailQueryKey]),
      getDependencies: () => {
        const currentDetail = queryClient.getQueryData<typeof authority>(
          detailQueryKey,
        );
        return pageDetailDataDependencies(currentDetail ?? null, pageId);
      },
      getCursor,
      invalidate: async () => {
        await invalidateExactQuery(queryClient, detailQueryKey);
      },
    });
    return () => {
      unregisterDetail();
    };
  }, [
    detail.data,
    detailQueryKey,
    pageId,
    projectionRegistry,
    queryClient,
  ]);

  if (detail.isPending) {
    return (
      <div
        className="flex h-full items-center justify-center bg-token-main-surface-primary text-sm text-token-description-foreground"
        role="status"
      >
        Opening Page…
      </div>
    );
  }

  if (detail.isError || !stagePage) {
    const error = detail.error;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-token-main-surface-primary px-6 text-center">
        <p className="text-sm text-token-text-primary">Could not open Page</p>
        <p className="max-w-lg text-sm text-token-description-foreground">
          {error instanceof Error ? error.message : "The Page is unavailable."}
        </p>
        <button
          type="button"
          className="mt-1 rounded-md bg-token-foreground/5 px-2.5 py-1.5 text-sm text-token-text-secondary hover:bg-token-foreground/10 hover:text-token-text-primary"
          onClick={() => {
            void detail.refetch();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <PageStage
      contentAccessContext={libraryContentAccess}
      editorSessionKey={`library-page:${surfaceId}`}
      retainEditorSession
      page={stagePage}
      autoFocusTitle={stagePage.page.title.trim() === "Untitled"}
      documentScopeId={pageId}
      projectName={null}
      onTitleChange={onTitleChange}
      onOpenDatabase={onOpenDatabase}
      onOpenPage={onOpenPage
        ? ({ pageId: nextPageId, titleSnapshot }) => {
            onOpenPage(nextPageId, titleSnapshot);
          }
        : undefined}
      onOpenCanvas={onOpenCanvas
        ? ({ canvasBlockId, titleSnapshot }) => {
            onOpenCanvas(canvasBlockId, titleSnapshot);
          }
        : undefined}
      toolbarPlacement={{ kind: "surface" }}
      onClose={onClose}
      isActivePanelTab={isActivePanelTab}
      onUpdate={async (targetPageId, patch) => {
        const result = await commitLibraryPageDetailMetadataPatch({
          pageId: targetPageId,
          operationId: crypto.randomUUID(),
          clientSessionId: `library-page:${pageId}`,
          patch,
        });
        await queryClient.invalidateQueries({
          queryKey: detailQueryKey,
          exact: true,
        });
        return result;
      }}
      onUpdateProperty={async (targetPageId, propertyId, edit) => {
        const result = await commitLibraryPageDetailPropertyEdit({
          pageId: targetPageId,
          propertyId,
          edit,
          operationId: crypto.randomUUID(),
          clientSessionId: `library-page:${pageId}`,
        });
        await queryClient.invalidateQueries({
          queryKey: detailQueryKey,
          exact: true,
        });
        return result;
      }}
    />
  );
}
