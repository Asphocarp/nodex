import { useEffect, useMemo } from "react";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";

import { PageStage } from "../workbench/workbench-page-stage";
import {
  createLibraryDocumentSyncAdapter,
  prepareLibraryOwnedBlockDocument,
  readLibraryPageDetail,
} from "../../lib/api";
import {
  LIBRARY_DOCUMENT_SURFACE_SCOPE_ID,
  type ReadyPageBlockDocumentDescriptor,
  toLibraryDocumentSurfaceDescriptor,
  unwrapLibraryOwnedBlockDocumentPreparationResult,
  validateLibraryOwnedBlockDocumentDescriptor,
} from "../../lib/owned-block-document";
import { projectPageDetailToStageModel } from "../../lib/page-stage-page";
import { commitLibraryPageDetailMetadataPatch } from "../../lib/page-detail-metadata-runtime";
import type { DatabaseId } from "../../../shared/database-identities";
import { queryKeys } from "../../lib/query-keys";
import { invalidateExactQuery } from "../../lib/query-invalidation";
import { useProjectionInvalidationRegistry } from "../../lib/projection-invalidation-context";

const libraryDocumentSurfaceDependencies = {
  createAdapter: () => createLibraryDocumentSyncAdapter(),
} as const;

export function LibraryPageRoute({
  pageId,
  onBack,
  onOpenDatabase,
}: {
  pageId: string;
  onBack: () => void;
  onOpenDatabase: (databaseId: DatabaseId) => void;
}) {
  const queryClient = useQueryClient();
  const projectionRegistry = useProjectionInvalidationRegistry();
  const detailQueryKey = useMemo(
    () => queryKeys.library.pageDetail(pageId),
    [pageId],
  );
  const documentQueryKey = useMemo(
    () => queryKeys.library.pageDocument(pageId),
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
  const document = useQuery({
    queryKey: documentQueryKey,
    queryFn: async () => {
      const descriptor = unwrapLibraryOwnedBlockDocumentPreparationResult(
        await prepareLibraryOwnedBlockDocument(pageId),
      );
      return toLibraryDocumentSurfaceDescriptor(
        validateLibraryOwnedBlockDocumentDescriptor(pageId, descriptor),
      );
    },
  });
  const stagePage = useMemo(() => {
    if (!detail.data) return null;
    return projectPageDetailToStageModel(detail.data);
  }, [detail.data]);

  useEffect(() => {
    const authority = detail.data;
    if (!authority) return;
    return projectionRegistry.register({
      scope: { kind: "library", libraryId: authority.libraryId },
      consumerKey: hashKey(["projection", detailQueryKey, documentQueryKey]),
      getDependencies: () => {
        const currentDocument =
          queryClient.getQueryData<ReadyPageBlockDocumentDescriptor>(
            documentQueryKey,
          );
        return {
          pageIds: [pageId],
          documentIds: currentDocument ? [currentDocument.documentId] : [],
        };
      },
      getCursor: () => {
        const currentDetail = queryClient.getQueryData<typeof authority>(detailQueryKey);
        const currentDocument =
          queryClient.getQueryData<ReadyPageBlockDocumentDescriptor>(documentQueryKey);
        if (!currentDetail || !currentDocument) return null;
        if (
          currentDetail.storeEpoch !== currentDocument.storeEpoch
          || currentDetail.page.documentGeneration !== currentDocument.generation
          || currentDetail.page.documentHeadSeq !== currentDocument.headSeq
        ) return null;
        return {
          storeEpoch: currentDetail.storeEpoch,
          changeLogSeq: currentDetail.changeLogSeq,
        };
      },
      invalidate: async () => {
        await Promise.all([
          invalidateExactQuery(queryClient, detailQueryKey),
          invalidateExactQuery(queryClient, documentQueryKey),
        ]);
      },
    });
  }, [
    detail.data,
    detailQueryKey,
    documentQueryKey,
    pageId,
    projectionRegistry,
    queryClient,
  ]);

  if (detail.isPending || document.isPending) {
    return (
      <div
        className="flex h-full items-center justify-center bg-token-main-surface-primary text-sm text-token-description-foreground"
        role="status"
      >
        Opening Page…
      </div>
    );
  }

  if (detail.isError || document.isError || !stagePage) {
    const error = detail.error ?? document.error;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-token-main-surface-primary px-6 text-center">
        <p className="text-sm text-token-text-primary">Could not open Page</p>
        <p className="max-w-lg text-sm text-token-description-foreground">
          {error instanceof Error ? error.message : "The Page is unavailable."}
        </p>
        <button
          type="button"
          className="rounded-md bg-token-button-secondary-background px-3 py-1.5 text-sm text-token-text-primary hover:bg-token-button-secondary-background-hover"
          onClick={onBack}
        >
          Back to Library
        </button>
      </div>
    );
  }

  return (
    <PageStage
      page={stagePage}
      autoFocusTitle={stagePage.page.title.trim() === "Untitled"}
      projectId={LIBRARY_DOCUMENT_SURFACE_SCOPE_ID}
      projectName="Library"
      availableTags={[]}
      documentAuthority={{
        kind: "yjs",
        descriptor: document.data,
        reload: async () => {
          await queryClient.resetQueries({ queryKey: documentQueryKey, exact: true });
        },
        surfaceDependencies: libraryDocumentSurfaceDependencies,
      }}
      onNavigateBack={onBack}
      onOpenDatabase={onOpenDatabase}
      onClose={onBack}
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
    />
  );
}
