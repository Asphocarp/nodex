import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { NfmMoveToSearchResult } from "@/components/board/editor/nfm-move-to-menu-search";
import { normalizeSearchText } from "@/lib/search-text";
import type { PageSearchResult, Project } from "@/lib/types";
import { invoke } from "./api";
import { useProjectionInvalidationRegistry } from "./projection-invalidation-context";
import { queryKeys } from "./query-keys";
import { WORKFLOW_STATUS_LABELS } from "../../shared/workflow-status";

const DESTINATION_SEARCH_LIMIT = 60;

function emptyResult(query: string): NfmMoveToSearchResult {
  return {
    normalizedQuery: normalizeSearchText(query),
    matchedProjectIds: new Set(),
    matchedColumnIdsByProjectId: new Map(),
    pageHits: [],
  };
}

export function mergeDestinationSearchResults(
  local: NfmMoveToSearchResult,
  remote: NfmMoveToSearchResult,
): NfmMoveToSearchResult {
  if (local.normalizedQuery !== remote.normalizedQuery) return local;

  const pageHits = new Map(local.pageHits.map((hit) => [hit.id, hit] as const));
  for (const hit of remote.pageHits) {
    const localHit = pageHits.get(hit.id);
    pageHits.set(hit.id, localHit
      ? {
          ...hit,
          boardOrder: localHit.boardOrder,
          pageKey: hit.pageKey ?? localHit.pageKey,
          score: Math.max(localHit.score, hit.score),
          matchedPageKey: hit.matchedPageKey ?? localHit.matchedPageKey,
          matchedPageKeyIsCurrent:
            hit.matchedPageKeyIsCurrent ?? localHit.matchedPageKeyIsCurrent,
        }
      : hit);
  }
  return {
    normalizedQuery: local.normalizedQuery,
    matchedProjectIds: new Set([
      ...local.matchedProjectIds,
      ...remote.matchedProjectIds,
    ]),
    matchedColumnIdsByProjectId: new Map([
      ...local.matchedColumnIdsByProjectId,
      ...remote.matchedColumnIdsByProjectId,
    ]),
    pageHits: [...pageHits.values()].sort((left, right) =>
      right.score - left.score || left.boardOrder - right.boardOrder),
  };
}

export function buildRemoteDestinationSearchResult({
  projects,
  query,
  results,
  sourceProjectId = null,
  sourcePageId = null,
}: {
  projects: readonly Project[];
  query: string;
  results: readonly PageSearchResult[];
  sourceProjectId?: string | null;
  sourcePageId?: string | null;
}): NfmMoveToSearchResult {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return emptyResult(query);

  const projectById = new Map(projects.map((project) => [project.id, project] as const));
  return {
    normalizedQuery,
    matchedProjectIds: new Set(),
    matchedColumnIdsByProjectId: new Map(),
    pageHits: results.flatMap((result, index) => {
      const project = projectById.get(result.projectId);
      if (!project) return [];
      if (!result.status) return [];
      if (result.projectId === sourceProjectId && result.pageId === sourcePageId) {
        return [];
      }
      const pageKeyMatch = result.matches.find((match) => match.source === "page_key");
      return [{
        id: `page:${result.projectId}:${result.pageId}`,
        projectId: result.projectId,
        projectName: project.name || "Untitled",
        projectAppearance: project.appearance,
        columnId: result.status,
        columnName: WORKFLOW_STATUS_LABELS[result.status],
        pageId: result.pageId,
        pageKey: result.pageKey ?? null,
        matchedPageKey: pageKeyMatch?.pageKey ?? null,
        matchedPageKeyIsCurrent: pageKeyMatch?.isCurrent ?? null,
        pageTitle: result.title || "Untitled",
        boardOrder: index,
        score: results.length - index,
      }];
    }),
  };
}

export function useProjectPageDestinationSearch({
  projects,
  query,
  enabled,
  sourceProjectId = null,
  sourcePageId = null,
}: {
  projects: readonly Project[];
  query: string;
  enabled: boolean;
  sourceProjectId?: string | null;
  sourcePageId?: string | null;
}): NfmMoveToSearchResult {
  const normalizedQuery = normalizeSearchText(query);
  const queryClient = useQueryClient();
  const projectionRegistry = useProjectionInvalidationRegistry();
  const projectIds = useMemo(
    () => projects.map((project) => project.id),
    [projects],
  );
  const databaseIds = useMemo(
    () => [...new Set(projects.map((project) => project.databaseId))],
    [projects],
  );
  const libraryId = projects[0]?.libraryId ?? null;
  const queryKey = useMemo(
    () => queryKeys.pageSearch.destinations(projectIds, normalizedQuery),
    [normalizedQuery, projectIds],
  );
  const search = useQuery({
    queryKey,
    enabled: enabled && normalizedQuery.length > 0 && projectIds.length > 0,
    queryFn: () => invoke("pages:search", {
      projectIds,
      query: normalizedQuery,
      limit: DESTINATION_SEARCH_LIMIT,
    }),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!enabled || !libraryId || !normalizedQuery || projectIds.length === 0) {
      return;
    }
    const consumerKey = hashKey(["projection", queryKey]);
    return projectIds.reduce<() => void>((releaseAll, projectId) => {
      const release = projectionRegistry.register({
        scope: { kind: "project", libraryId, projectId },
        consumerKey,
        getDependencies: () => ({ databaseIds }),
        getCursor: () => null,
        invalidate: async () => {
          await queryClient.invalidateQueries({ queryKey, exact: true });
        },
      });
      return () => {
        release();
        releaseAll();
      };
    }, () => undefined);
  }, [
    databaseIds,
    enabled,
    libraryId,
    normalizedQuery,
    projectIds,
    projectionRegistry,
    queryClient,
    queryKey,
  ]);

  return useMemo(
    () => buildRemoteDestinationSearchResult({
      projects,
      query: normalizedQuery,
      results: search.data ?? [],
      sourceProjectId,
      sourcePageId,
    }),
    [normalizedQuery, projects, search.data, sourcePageId, sourceProjectId],
  );
}
