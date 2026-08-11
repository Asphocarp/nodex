import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { NfmMoveToSearchResult } from "@/components/board/editor/nfm-move-to-menu-search";
import { normalizeSearchText } from "@/lib/search-text";
import type { PageSearchResult, Project } from "@/lib/types";
import { invoke } from "./api";
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
    pageHits.set(hit.id, hit);
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
      if (result.projectId === sourceProjectId && result.pageId === sourcePageId) {
        return [];
      }
      return [{
        id: `page:${result.projectId}:${result.pageId}`,
        projectId: result.projectId,
        projectName: project.name || "Untitled",
        projectAppearance: project.appearance,
        columnId: result.status,
        columnName: WORKFLOW_STATUS_LABELS[result.status],
        pageId: result.pageId,
        pageTitle: result.title || "Untitled",
        boardOrder: index,
        score: result.score,
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
  const projectIds = useMemo(
    () => projects.map((project) => project.id),
    [projects],
  );
  const search = useQuery({
    queryKey: ["project-page-destination-search", projectIds, normalizedQuery],
    enabled: enabled && normalizedQuery.length > 0 && projectIds.length > 0,
    queryFn: () => invoke("pages:search", {
      projectIds,
      query: normalizedQuery,
      limit: DESTINATION_SEARCH_LIMIT,
    }),
    staleTime: 30_000,
  });

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
