import { queryOptions, useQuery } from "@tanstack/react-query";
import { prepareOwnedBlockDocument } from "./api";
import {
  fetchOwnedBlockDocumentDescriptor,
  makeOwnedBlockDocumentModel,
  unwrapOwnedBlockDocumentPreparationResult,
  type OwnedBlockDocumentDescriptorFetcher,
  type OwnedBlockDocumentModel,
  type OwnedBlockDocumentRequest,
} from "./owned-block-document";
import { queryKeys } from "./query-keys";

export interface OwnedBlockDocumentQueryDependencies {
  readonly fetchDescriptor?: OwnedBlockDocumentDescriptorFetcher;
}

const defaultFetcher: OwnedBlockDocumentDescriptorFetcher = (
  projectId,
  ownerBlockId,
) => prepareOwnedBlockDocument(projectId, ownerBlockId).then(
  unwrapOwnedBlockDocumentPreparationResult,
);

const makeOwnedBlockDocumentQueryFn =
  (
    request: OwnedBlockDocumentRequest,
    fetcher: OwnedBlockDocumentDescriptorFetcher,
  ) =>
  () =>
    fetchOwnedBlockDocumentDescriptor(request, fetcher);

export const ownedBlockDocumentQueryOptions = (
  request: OwnedBlockDocumentRequest,
  dependencies: OwnedBlockDocumentQueryDependencies = {},
) => {
  const fetcher = dependencies.fetchDescriptor ?? defaultFetcher;
  return queryOptions({
    queryKey: queryKeys.blockDocuments.owned(
      request.projectId,
      request.ownerBlockId,
    ),
    queryFn: makeOwnedBlockDocumentQueryFn(request, fetcher),
  });
};

export const useOwnedBlockDocument = (
  request: OwnedBlockDocumentRequest,
  dependencies: OwnedBlockDocumentQueryDependencies = {},
): OwnedBlockDocumentModel => {
  const query = useQuery(ownedBlockDocumentQueryOptions(request, dependencies));
  if (query.status === "pending") {
    return makeOwnedBlockDocumentModel(request, { status: "pending" });
  }
  if (query.status === "error") {
    return makeOwnedBlockDocumentModel(request, {
      status: "error",
      error: query.error,
    });
  }
  return makeOwnedBlockDocumentModel(request, {
    status: "success",
    data: query.data,
  });
};
