import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_PROJECT_APPEARANCE } from "../../shared/project-appearance";
import type { ProjectionScope, ProjectionStreamMessage } from "../../shared/projection-stream";
import type { Project } from "./types";
import { ProjectionInvalidationProvider } from "./projection-invalidation-context";
import { ProjectionInvalidationRegistry } from "./projection-invalidation-registry";
import { invoke } from "./api";
import { useProjectPageDestinationSearch } from "./use-project-page-destination-search";

vi.mock("./api", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

const project = (): Project => ({
  id: "project-1",
  libraryId: "library-1",
  databaseId: "database-1",
  defaultDatabaseViewId: "view-1",
  lifecycle: "active",
  bindingRevision: 1,
  name: "Lab",
  description: "",
  appearance: DEFAULT_PROJECT_APPEARANCE,
  sources: [],
  primaryWorkspaceRoot: null,
  pinned: false,
  pinnedOrder: null,
  created: new Date("2026-08-14T00:00:00.000Z"),
  updated: new Date("2026-08-14T00:00:00.000Z"),
});

const databaseEffect = (
  scope: ProjectionScope,
  databaseId: string,
  commitSeq: number,
): ProjectionStreamMessage => ({
  version: 2,
  kind: "effect",
  scope,
  stream: { storeEpoch: "epoch-1", commitSeq },
  delivery: {
    storeEpoch: "epoch-1",
    commitSeq,
    manifestHash: "a".repeat(64),
    operationId: `operation-${commitSeq}`,
    committedAt: "2026-08-14T00:00:00.000Z",
    impact: {
      kind: "resources",
      page_ids: [],
      database_ids: [databaseId],
      data_source_ids: [],
      view_ids: [],
      document_heads: [],
    },
    effect: {
      scope: {
        schema_version: 1,
        canonical_key: `page-detail-database:${databaseId}`,
        scope: {
          kind: "page_detail_database",
          project_id: "project-1",
          database_id: databaseId,
        },
      },
      baseRevision: commitSeq - 1,
      resultRevision: commitSeq,
      coveredCommitSeq: commitSeq,
      patch: null,
      requiresReadAtLeast: true,
      effectHash: "b".repeat(64),
    },
  },
});

describe("Project Page destination search freshness", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  test("refetches a warm query for the affected Database only", async () => {
    const listeners = new Map<string, (message: ProjectionStreamMessage) => void>();
    const registry = new ProjectionInvalidationRegistry({
      subscribeProjection: (scope, listener) => {
        listeners.set(JSON.stringify(scope), listener);
        return () => listeners.delete(JSON.stringify(scope));
      },
      subscribeRevocations: () => () => undefined,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockedInvoke
      .mockResolvedValueOnce([{
        projectId: "project-1",
        pageId: "page-1",
        pageKey: "LAB-13",
        matchedPageKey: "LAB-13",
        matchedPageKeyIsCurrent: true,
        title: "Launch",
        status: "build",
        score: 1_000_000,
        excerpt: "Launch",
      }])
      .mockResolvedValueOnce([{
        projectId: "project-1",
        pageId: "page-1",
        pageKey: "RND-13",
        matchedPageKey: "LAB-13",
        matchedPageKeyIsCurrent: false,
        title: "Launch",
        status: "build",
        score: 1_000_000,
        excerpt: "Launch",
      }]);
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ProjectionInvalidationProvider registry={registry}>
          {children}
        </ProjectionInvalidationProvider>
      </QueryClientProvider>
    );
    const hook = renderHook(() => useProjectPageDestinationSearch({
      projects: [project()],
      query: "LAB-13",
      enabled: true,
    }), { wrapper });

    await waitFor(() => expect(hook.result.current.pageHits[0]?.pageKey).toBe("LAB-13"));
    const listener = listeners.get(JSON.stringify({
      kind: "project",
      libraryId: "library-1",
      projectId: "project-1",
    }));
    expect(listener).toBeDefined();

    await act(async () => {
      listener?.(databaseEffect({
        kind: "project",
        libraryId: "library-1",
        projectId: "project-1",
      }, "database-unrelated", 1));
      await Promise.resolve();
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      listener?.(databaseEffect({
        kind: "project",
        libraryId: "library-1",
        projectId: "project-1",
      }, "database-1", 2));
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.pageHits[0]).toMatchObject({
      pageKey: "RND-13",
      matchedPageKey: "LAB-13",
      matchedPageKeyIsCurrent: false,
    }));
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });
});
