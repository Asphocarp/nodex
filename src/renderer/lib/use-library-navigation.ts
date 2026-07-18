import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

import {
  LIBRARY_MODULE_CONTRACT_VERSION,
  type LibraryApplyOperation,
  type LibraryModuleReadRequest,
  type LibraryNavigationParent,
  type LibraryReadValue,
  type LibraryRouteTarget,
} from "../../shared/library-module";
import {
  applyLibraryModule,
  readLibraryModule,
  subscribeLibraryChanges,
} from "./api";
import { createUuidV7 } from "../../shared/uuid-v7";

export const libraryModuleQueryKey = ["library-module"] as const;

export const libraryMetadataQueryOptions = () => queryOptions({
  queryKey: [...libraryModuleQueryKey, "metadata"] as const,
  queryFn: async () => {
    const result = await readLibraryModule({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: { mode: "metadata" },
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  },
  staleTime: 30_000,
});

const requireReadValue = async <Kind extends LibraryReadValue["kind"]>(
  request: LibraryModuleReadRequest,
  kind: Kind,
): Promise<Extract<LibraryReadValue, { kind: Kind }>> => {
  const result = await readLibraryModule(request);
  if (!result.ok) throw new Error(result.error.message);
  if (result.value.value.kind !== kind) {
    throw new Error(`Library read returned ${result.value.value.kind}, expected ${kind}`);
  }
  return result.value.value as Extract<LibraryReadValue, { kind: Kind }>;
};

const parentKey = (parent: LibraryNavigationParent): string => {
  if (parent.kind === "library") return "library";
  if (parent.kind === "page") return `page:${parent.pageId}`;
  return `database:${parent.databaseId}`;
};

export const libraryChildrenQueryOptions = (
  parent: LibraryNavigationParent,
  input: Readonly<{
    cursor?: string;
    limit?: number;
    forceIncludeTarget?: Extract<
      LibraryModuleReadRequest["read"],
      { mode: "children" }
    >["forceIncludeTarget"];
  }> = {},
) => queryOptions({
  queryKey: [
    ...libraryModuleQueryKey,
    "children",
    parentKey(parent),
    input,
    input.cursor ?? null,
    input.limit ?? null,
    input.forceIncludeTarget ?? null,
  ] as const,
  queryFn: () => requireReadValue({
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    read: {
      mode: "children",
      parent,
      ...input,
    },
  }, "children"),
  staleTime: 30_000,
});

export const libraryCatalogQueryOptions = (
  input: Omit<
    Extract<LibraryModuleReadRequest["read"], { mode: "catalog" }>,
    "mode"
  > = {},
) => queryOptions({
  queryKey: [...libraryModuleQueryKey, "catalog", input] as const,
  queryFn: () => requireReadValue({
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    read: { mode: "catalog", ...input },
  }, "catalog"),
  staleTime: 30_000,
});

export const libraryPathQueryOptions = (target: LibraryRouteTarget) =>
  queryOptions({
    queryKey: [...libraryModuleQueryKey, "path", target] as const,
    queryFn: () => requireReadValue({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: { mode: "path", target },
    }, "path"),
    staleTime: 30_000,
  });

export const useLibraryNavigationInvalidation = (): void => {
  const queryClient = useQueryClient();
  useEffect(() => subscribeLibraryChanges(() => {
    void queryClient.resetQueries({ queryKey: libraryModuleQueryKey });
  }), [queryClient]);
};

export const useLibraryMetadata = (enabled = true) => useQuery({
  ...libraryMetadataQueryOptions(),
  enabled,
});

export const useApplyLibraryOperation = (enabled = true) => {
  const queryClient = useQueryClient();
  const metadata = useLibraryMetadata(enabled);
  const mutation = useMutation({
    mutationFn: async (operation: LibraryApplyOperation) => {
      if (!enabled) throw new Error("Library workspace is unavailable");
      if (!metadata.data) throw new Error("Library identity is not ready");
      const result = await applyLibraryModule({
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        operationId: createUuidV7(),
        storeEpoch: metadata.data.storeEpoch,
        operation,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryModuleQueryKey });
    },
  });
  return { metadata, mutation };
};

export const useLibraryChildren = (
  parent: LibraryNavigationParent,
  input: Parameters<typeof libraryChildrenQueryOptions>[1] = {},
  enabled = true,
) => useQuery({
  ...libraryChildrenQueryOptions(parent, input),
  enabled,
});

export const useInfiniteLibraryChildren = (
  parent: LibraryNavigationParent,
  input: Omit<
    NonNullable<Parameters<typeof libraryChildrenQueryOptions>[1]>,
    "cursor"
  > = {},
  enabled = true,
) => useInfiniteQuery({
  queryKey: [
    ...libraryModuleQueryKey,
    "children-pages",
    parentKey(parent),
    input,
    input.limit ?? null,
    input.forceIncludeTarget ?? null,
  ] as const,
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam }) => requireReadValue({
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    read: {
      mode: "children",
      parent,
      ...input,
      ...(pageParam ? { cursor: pageParam } : {}),
    },
  }, "children"),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
  staleTime: 30_000,
  enabled,
});

export const useLibraryPath = (
  target: LibraryRouteTarget,
  enabled = true,
) => useQuery({ ...libraryPathQueryOptions(target), enabled });

export const useLibraryCatalog = (
  input: Parameters<typeof libraryCatalogQueryOptions>[0] = {},
  enabled = true,
) => useQuery({ ...libraryCatalogQueryOptions(input), enabled });

export const useInfiniteLibraryCatalog = (
  input: Omit<
    Parameters<typeof libraryCatalogQueryOptions>[0],
    "cursor"
  > = {},
) => useInfiniteQuery({
  queryKey: [...libraryModuleQueryKey, "catalog-pages", input] as const,
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam }) => requireReadValue({
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    read: {
      mode: "catalog",
      ...input,
      ...(pageParam ? { cursor: pageParam } : {}),
    },
  }, "catalog"),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
  staleTime: 30_000,
});
