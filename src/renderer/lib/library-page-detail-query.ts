import { queryOptions, type QueryKey } from "@tanstack/react-query";

import type { AuthorizedReadStamp } from "../../shared/authorized-read-stamp";
import { readLibraryPageDetail } from "./api";
import { queryKeys } from "./query-keys";
import {
  admitResourceAuthorityQuery,
  resourceAuthorityQueryMeta,
} from "./resource-authority-query-cache";

const resolveLibraryPageDetailAuthority = (
  _queryKey: readonly unknown[],
  data: unknown,
) => {
  const authorization = (data as {
    readonly authorization?: AuthorizedReadStamp | null;
  } | null)?.authorization;
  return authorization ? { authorizations: [authorization] } : null;
};

export const libraryPageDetailQueryOptions = (
  pageId: string,
  relatedQueryKeys: readonly QueryKey[] = [queryKeys.library.pageDocument(pageId)],
) => queryOptions({
  queryKey: queryKeys.library.pageDetail(pageId),
  queryFn: async () => {
    const result = await readLibraryPageDetail(pageId);
    if (!result.ok) throw new Error(result.error.message);
    return await admitResourceAuthorityQuery(
      result.value,
      resolveLibraryPageDetailAuthority,
    );
  },
  meta: resourceAuthorityQueryMeta((_queryKey, data) => {
    const resolved = resolveLibraryPageDetailAuthority(_queryKey, data);
    return resolved ? { ...resolved, relatedQueryKeys } : null;
  }),
});
