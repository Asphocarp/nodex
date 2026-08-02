import type { ContentAccessContext } from "../../shared/content-access-context";
import {
  createLibraryDocumentSyncAdapter,
  prepareLibraryOwnedBlockDocument,
} from "./api";
import type { BlockDocumentSurfaceDependencies } from "@/components/block-documents/block-document-surface";
import type { OwnedBlockDocumentQueryDependencies } from "./owned-block-document-query";
import {
  LIBRARY_DOCUMENT_SURFACE_SCOPE_ID,
  unwrapLibraryOwnedBlockDocumentPreparationResult,
} from "./owned-block-document";

export const libraryBlockDocumentSurfaceDependencies = {
  createAdapter: () => createLibraryDocumentSyncAdapter(),
} as const satisfies BlockDocumentSurfaceDependencies;

export const libraryOwnedBlockDocumentQueryDependencies = {
  fetchDescriptor: async (_documentScopeId, ownerBlockId) => {
    const descriptor = unwrapLibraryOwnedBlockDocumentPreparationResult(
      await prepareLibraryOwnedBlockDocument(ownerBlockId),
    );
    const { accessContext, ...surfaceDescriptor } = descriptor;
    if (
      accessContext.kind !== "library" ||
      Object.keys(accessContext).length !== 1
    ) {
      throw new Error(
        "Library Owned Block Document access context is invalid",
      );
    }
    return {
      ...surfaceDescriptor,
      projectId: LIBRARY_DOCUMENT_SURFACE_SCOPE_ID,
    };
  },
} as const satisfies OwnedBlockDocumentQueryDependencies;

export const ownedBlockDocumentQueryDependenciesForContentAccess = (
  context: ContentAccessContext,
): OwnedBlockDocumentQueryDependencies | undefined =>
  context.kind === "library"
    ? libraryOwnedBlockDocumentQueryDependencies
    : undefined;

export const blockDocumentSurfaceDependenciesForContentAccess = (
  context: ContentAccessContext,
): BlockDocumentSurfaceDependencies | undefined =>
  context.kind === "library"
    ? libraryBlockDocumentSurfaceDependencies
    : undefined;
