import { queryOptions, useQuery } from "@tanstack/react-query";
import { prepareOwnedBlockDocumentForContentAccess } from "./api";
import {
  fetchOwnedBlockDocumentDescriptor,
  fetchRegisteredOwnedBlockDocumentDescriptor,
  makeOwnedBlockDocumentModel,
  makeRegisteredOwnedBlockDocumentModel,
  unwrapOwnedBlockDocumentPreparationResult,
  type OwnedDocumentDescriptorFetcher,
  type OwnedBlockDocumentModel,
  type OwnedBlockDocumentRequest,
  type RegisteredOwnedBlockDocumentModel,
} from "./owned-block-document";
import { queryKeys } from "./query-keys";
import type { AuthorizedReadStamp } from "../../shared/authorized-read-stamp";
import {
  admitResourceAuthorityQuery,
  resourceAuthorityQueryMeta,
} from "./resource-authority-query-cache";

const resolveOwnedDocumentAuthority = (_queryKey: readonly unknown[], data: unknown) => {
  const authorization = (data as {
    readonly authorization?: AuthorizedReadStamp | null;
  } | null)?.authorization;
  return authorization ? { authorizations: [authorization] } : null;
};

const ownedDocumentAuthorityMeta = resourceAuthorityQueryMeta(
  resolveOwnedDocumentAuthority,
);

export interface OwnedBlockDocumentQueryDependencies {
  readonly fetchDescriptor?: OwnedDocumentDescriptorFetcher;
}

const defaultFetcher: OwnedDocumentDescriptorFetcher = (
  accessContext,
  ownerBlockId,
) =>
  prepareOwnedBlockDocumentForContentAccess(accessContext, ownerBlockId).then(
    unwrapOwnedBlockDocumentPreparationResult,
  );

const makeOwnedBlockDocumentQueryFn =
  (
    request: OwnedBlockDocumentRequest,
    fetcher: OwnedDocumentDescriptorFetcher,
  ) =>
  async () => admitResourceAuthorityQuery(
    await fetchOwnedBlockDocumentDescriptor(request, fetcher),
    resolveOwnedDocumentAuthority,
  );

const makeRegisteredOwnedBlockDocumentQueryFn =
  (
    request: OwnedBlockDocumentRequest,
    fetcher: OwnedDocumentDescriptorFetcher,
  ) =>
  async () => admitResourceAuthorityQuery(
    await fetchRegisteredOwnedBlockDocumentDescriptor(request, fetcher),
    resolveOwnedDocumentAuthority,
  );

export const ownedBlockDocumentQueryOptions = (
  request: OwnedBlockDocumentRequest,
  dependencies: OwnedBlockDocumentQueryDependencies = {},
) => {
  const fetcher = dependencies.fetchDescriptor ?? defaultFetcher;
  return queryOptions({
    queryKey: queryKeys.blockDocuments.owned(
      request.accessContext,
      request.ownerBlockId,
    ),
    queryFn: makeOwnedBlockDocumentQueryFn(request, fetcher),
    meta: ownedDocumentAuthorityMeta,
  });
};

export const registeredOwnedBlockDocumentQueryOptions = (
  request: OwnedBlockDocumentRequest,
  dependencies: OwnedBlockDocumentQueryDependencies = {},
) => {
  const fetcher = dependencies.fetchDescriptor ?? defaultFetcher;
  return queryOptions({
    queryKey: queryKeys.blockDocuments.owned(
      request.accessContext,
      request.ownerBlockId,
    ),
    queryFn: makeRegisteredOwnedBlockDocumentQueryFn(request, fetcher),
    meta: ownedDocumentAuthorityMeta,
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

export const useRegisteredOwnedBlockDocument = (
  request: OwnedBlockDocumentRequest,
  dependencies: OwnedBlockDocumentQueryDependencies = {},
): RegisteredOwnedBlockDocumentModel => {
  const query = useQuery(
    registeredOwnedBlockDocumentQueryOptions(request, dependencies),
  );
  if (query.status === "pending") {
    return makeRegisteredOwnedBlockDocumentModel(request, {
      status: "pending",
    });
  }
  if (query.status === "error") {
    return makeRegisteredOwnedBlockDocumentModel(request, {
      status: "error",
      error: query.error,
    });
  }
  return makeRegisteredOwnedBlockDocumentModel(request, {
    status: "success",
    data: query.data,
  });
};
